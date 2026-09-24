import "server-only";
import { after } from "next/server";
import { logEvent } from "@/server/http/log";

/**
 * 认证邮件在响应之后投递（AUTH-VERIFY-FAILURE 与认证邮件时序旁路修复）。
 *
 * 匿名入口（发送验证邮件、找回密码、注册）若在请求内等待 SMTP，响应状态与耗时会随
 * 「账号是否存在 / 是否已验证」而不同，可被用于枚举账号：投递失败时匿名重发返回 500，
 * 成功时已注册邮箱多出一整段 SMTP 往返。这里让 Better Auth 的发信 hook 立即返回，
 * 实际投递通过 Next `after()` 在响应结束后执行（Next 优雅停机会等待 after 任务）；
 * 不在请求作用域（集成测试、脚本）时同样在返回后异步执行。
 *
 * 投递失败只写脱敏事件（email.ts 的 auth_email_failed），不回传调用方；用户可重新发送。
 * 并发有界，积压过多时丢弃并记录 auth_email_dropped，避免 SMTP 故障拖垮进程内存。
 */

type AuthEmailKind = "verify-email" | "reset-password";

const MAX_ACTIVE_DELIVERIES = 4;
const MAX_WAITING_DELIVERIES = 200;

type DeliveryQueue = {
  active: number;
  waiting: Array<() => void>;
  inflight: Set<Promise<void>>;
};

const globals = globalThis as typeof globalThis & { __orbitAuthEmailQueue__?: DeliveryQueue };
const queue = (): DeliveryQueue =>
  (globals.__orbitAuthEmailQueue__ ??= { active: 0, waiting: [], inflight: new Set() });

async function deliver(kind: AuthEmailKind, send: () => Promise<void>): Promise<void> {
  const state = queue();
  if (state.active >= MAX_ACTIVE_DELIVERIES) {
    if (state.waiting.length >= MAX_WAITING_DELIVERIES) {
      logEvent("error", { event: "auth_email_dropped", kind });
      return;
    }
    // release() 把名额直接交给等待者，active 计数保持不变。
    await new Promise<void>((resolve) => state.waiting.push(resolve));
  } else {
    state.active++;
  }
  try {
    await send();
  } catch {
    // email.ts 已记录脱敏的 auth_email_failed；匿名调用方不得感知投递结果。
  } finally {
    const next = state.waiting.shift();
    if (next) next();
    else state.active--;
  }
}

/** 安排一次认证邮件投递；永不向认证端点抛错，也不延长其响应。 */
export function dispatchAuthEmail(kind: AuthEmailKind, send: () => Promise<void>): void {
  const state = queue();
  const task = (): Promise<void> => {
    const running = deliver(kind, send);
    state.inflight.add(running);
    void running.finally(() => state.inflight.delete(running));
    return running;
  };
  try {
    after(task);
  } catch {
    void task();
  }
}

/** 等待已开始的投递全部结束（测试与诊断使用）。 */
export async function drainAuthEmails(): Promise<void> {
  const state = queue();
  while (state.inflight.size > 0) await Promise.allSettled([...state.inflight]);
}
