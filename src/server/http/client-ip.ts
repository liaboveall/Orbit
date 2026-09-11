import "server-only";
import { getEnv } from "@/server/env";

/**
 * 客户端 IP 解析（A07 审查修复，docs/03 §8）。
 *
 * 背景：匿名端点（如 /invitations/preview）没有会话可用于按用户限流，只能按来源 IP
 * 限流；但 `X-Forwarded-For` 是客户端可自由设置的普通请求头，直接相信它等于允许
 * 攻击者在头部随意填入任意字符串绕过限流（一人伪装成一万个不同 IP）。
 *
 * 规则（TRUSTED_PROXY_COUNT，默认 0）：
 *  - 只有配置了明确的受信任代理跳数时，才从 `X-Forwarded-For` 链条中取「倒数第 N 个」
 *    条目（该位置由最靠近本机的受信代理写入，更外层的值不可信、可被客户端伪造）。
 *  - TRUSTED_PROXY_COUNT=0（未配置，单 Node 进程直连场景的默认值）：不解析任何转发头，
 *    返回固定占位符 —— 退化为「全部匿名请求共享一个限流桶」，仍能限制总体速率，
 *    只是不能按来源区分，这比误信任意伪造头更安全。
 *  - Next.js `Request` 不暴露底层 TCP remoteAddress，所以「不信任转发头」时没有更精确的
 *    真实来源可用；调大 TRUSTED_PROXY_COUNT 前必须确认部署拓扑确实有该层数的代理。
 */
const NO_TRUSTED_PROXY_BUCKET = "__no-trusted-proxy__";

/** 从逗号分隔的 X-Forwarded-For 链条解析出受信代理边界内的客户端 IP。 */
export function resolveClientIp(request: Request): string {
  const trustedProxyCount = getEnv().TRUSTED_PROXY_COUNT;
  if (trustedProxyCount <= 0) {
    return NO_TRUSTED_PROXY_BUCKET;
  }

  const header = request.headers.get("x-forwarded-for");
  if (!header) {
    return NO_TRUSTED_PROXY_BUCKET;
  }

  // 链条格式：client, proxy1, proxy2, ...；每层受信代理会在自己收到的值后追加一项，
  // 因此「倒数第 TRUSTED_PROXY_COUNT 个」是最后一层受信代理直接看到的来源，
  // 其左侧（更靠前）的值可能是客户端自行塞入的伪造内容，不采信。
  const chain = header
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  if (chain.length === 0) return NO_TRUSTED_PROXY_BUCKET;

  const index = chain.length - trustedProxyCount;
  const candidate = chain[Math.max(0, Math.min(index, chain.length - 1))];
  return candidate && candidate.length > 0 ? candidate : NO_TRUSTED_PROXY_BUCKET;
}
