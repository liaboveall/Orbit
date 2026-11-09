import type { APIRequestContext, Cookie } from "@playwright/test";

/**
 * UI 回归测试的会话前置（M1 / ORB-006 之后）。
 *
 * 背景：/app/* 由 `src/proxy.ts`（Edge 层按 session cookie 是否存在快速门禁）
 * 与 `src/app/app/layout.tsx` 的 `getSessionUser`（权威会话校验）双层保护。
 * M0 回归用例直接 `page.goto("/app/projects/.../board")`，没有会话 cookie 会被
 * proxy 重定向到 /auth/login，导致全部用例失败。此模块负责在测试开始前建立一个
 * **真实、已验证**的会话，并返回可注入浏览器上下文的 cookie。
 *
 * 之所以走 HTTP + Mailpit（而非直接写库）：
 *  - 复用应用真实认证链路（sign-up → 验证邮件 → verify-email 的 autoSignIn），
 *    与 tests/e2e/auth.spec.ts 的主流程一致，不引入对内部表结构的耦合；
 *  - 不导入 @/server（避免 Playwright 侧解析 `@/` 别名与 server-only 的额外风险）。
 *
 * E2E 和 UI 配置均通过 scripts/e2e-server.mjs 启动隔离服务，强制 APP_ENV=test、
 * DATABASE_URL=TEST_DATABASE_URL，并验证目标库、端口和内容指纹；不连接已有开发服务。
 * E2E_AUTH_ORIGIN 由根 Playwright 配置传入，POST 使用该 Origin。
 */

const MAILPIT_API = process.env.MAILPIT_API ?? "http://localhost:8025/api/v1";
/** Better Auth 受信源（POST 端点的 Origin 头必须命中它，否则 403）。 */
const TRUSTED_ORIGIN =
  process.env.E2E_AUTH_ORIGIN ?? `http://localhost:${process.env.E2E_PORT ?? "3000"}`;
/** 验证邮件主题片段（与 src/server/auth/email.ts 的 sendVerificationEmail 一致）。 */
const VERIFY_SUBJECT = "验证你的 Orbit 邮箱";
const PASSWORD = "Str0ng!Passw0rd-UiTest"; // ≥12 位，满足密码策略
const NAME = "UI 回归用户";

// Both Playwright configurations start the isolated APP_ENV=test server.
// Auth rate limiting is independently exercised with enabled real handlers in integration tests.
// Do not artificially sleep for production limits in this test-only fixture.

type MailpitSummary = {
  ID: string;
  Subject: string;
  Created: string;
  To: Array<{ Address: string }>;
};
type MailpitMessage = { Text?: string; HTML?: string };

/**
 * 轮询 Mailpit，取精确发往 `to`、主题为验证邮件的最新一封，提取其中的 `token`。
 *
 * 注意（沿用 tests/e2e 的经验）：Mailpit 的 `to:` 检索是分词模糊匹配，必须按精确收件人
 * 地址复核；token 在 HTML 里 `&` 会被转义为 `&amp;`，故只提取 `token=` 的值再自行重建链接。
 */
async function waitForVerificationToken(
  request: APIRequestContext,
  to: string,
  timeoutMs = 20000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const target = to.toLowerCase();
  let lastError = "尚未开始轮询";
  while (Date.now() < deadline) {
    const res = await request.get(`${MAILPIT_API}/messages`, {
      params: { query: `to:${to}`, limit: "100" },
    });
    if (res.ok()) {
      const json = (await res.json()) as { messages?: MailpitSummary[] };
      const hit = (json.messages ?? [])
        .filter((m) => m.To.some((a) => a.Address.toLowerCase() === target))
        .filter((m) => m.Subject.includes(VERIFY_SUBJECT))
        .sort((a, b) => (a.Created < b.Created ? 1 : -1))[0];
      if (hit) {
        const full = await request.get(`${MAILPIT_API}/message/${hit.ID}`);
        const msg = (await full.json()) as MailpitMessage;
        const body = `${msg.Text ?? ""}\n${msg.HTML ?? ""}`;
        const match = /[?&]token=([^&\s"'<>]+)/.exec(body);
        if (match?.[1]) return decodeURIComponent(match[1]);
        lastError = `验证邮件（ID=${hit.ID}）正文中未找到 token`;
      } else {
        lastError = `尚无精确发往 ${to} 且主题含「${VERIFY_SUBJECT}」的邮件`;
      }
    } else {
      lastError = `Mailpit 查询失败：HTTP ${res.status()}（MAILPIT_API=${MAILPIT_API}）`;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`等待验证邮件超时：${lastError}`);
}

/**
 * 建立一个已验证会话并返回可注入浏览器上下文的 cookie。
 *
 * @param request  Playwright 独立 APIRequestContext（自带 cookie jar，与浏览器上下文隔离）
 * @param apiOrigin 实际发起请求的源，应与浏览器 baseURL 同源，保证 cookie 域与导航主机一致
 * @param meta 可选出参：回填本次创建的测试用户 email，供调用方在测试结束后精确清理数据
 */
export async function establishSessionCookies(
  request: APIRequestContext,
  apiOrigin: string,
  meta?: { email?: string },
): Promise<Cookie[]> {
  const origin = apiOrigin.replace(/\/+$/, "");
  const email = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@orbit.test`;
  if (meta) meta.email = email;
  const headers = { origin: TRUSTED_ORIGIN, "content-type": "application/json" };

  // 1) 注册唯一用户：requireEmailVerification 下不建会话，仅触发验证邮件。
  const postSignUp = () =>
    request.post(`${origin}/api/auth/sign-up/email`, {
      headers,
      data: { email, password: PASSWORD, name: NAME },
    });
  let signUp = await postSignUp();
  // 兜底：若仍偶发 429（窗口边界 / 其它未纳入统计的注册），按 X-Retry-After 退避后重试，
  // 不跳过、不弱化断言——仅等待限流窗口恢复后重新发起同一注册。
  for (let attempt = 0; signUp.status() === 429 && attempt < 6; attempt++) {
    const retryAfterHeader = signUp.headers()["x-retry-after"];
    const retryAfterSec = Number(retryAfterHeader);
    const backoffMs =
      (Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec : 15) * 1000 + 1000;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    signUp = await postSignUp();
  }
  if (!signUp.ok()) {
    throw new Error(
      `注册测试用户失败：HTTP ${signUp.status()} ${await signUp.text()}（检查 dev server 与 Origin/数据库配置）`,
    );
  }

  // 2) 从 Mailpit 取验证邮件的 token，重建同源验证链接（避免 localhost/127.0.0.1 主机差异）。
  const token = await waitForVerificationToken(request, email);
  const verifyUrl =
    `${origin}/api/auth/verify-email?token=${encodeURIComponent(token)}` +
    `&callbackURL=${encodeURIComponent("/auth/verify")}`;

  // 3) 消费验证链接：GET 无 Origin 校验；autoSignInAfterVerification 建会话并下发 session cookie，
  //    随后 302 到 callbackURL（/auth/verify，已登录也可访问），Playwright 自动跟随即可。
  const verify = await request.get(verifyUrl);
  if (verify.status() >= 400) {
    throw new Error(`邮箱验证失败：HTTP ${verify.status()} ${await verify.text()}`);
  }

  // 4) 取回该源的 cookie（含 better-auth session_token），供 context.addCookies 注入。
  const state = await request.storageState();
  const hostname = new URL(origin).hostname;
  const cookies = state.cookies.filter((c) => c.domain.replace(/^\./, "") === hostname);
  if (!cookies.some((c) => /session_token/.test(c.name))) {
    throw new Error(
      "验证后未取得 session cookie（检查 Mailpit 是否可达、BETTER_AUTH_URL 与 baseURL 主机是否一致）",
    );
  }
  return cookies;
}

/**
 * 创建真实项目和任务用于 UI 测试（ORB-012 验收项）。
 * 
 * @param request APIRequestContext（已有 session cookie）
 * @param apiOrigin API origin
 * @returns { projectId, taskId }
 */
export async function createProjectAndTask(
  request: APIRequestContext,
  apiOrigin: string,
): Promise<{ projectId: string; taskId: string }> {
  const origin = apiOrigin.replace(/\/+$/, "");
  const headers = { 
    origin: TRUSTED_ORIGIN, 
    "content-type": "application/json",
    "Idempotency-Key": crypto.randomUUID(), // 后端要求幂等键（docs/05 §5）
  };
  
  // 1) 创建项目
  const projectRes = await request.post(`${origin}/api/v1/projects`, {
    headers,
    data: {
      name: "UI 测试项目",
      key: `UT${Math.floor(Math.random() * 1e6).toString().padStart(6, "0")}`, // ProjectKeySchema /^[A-Z][A-Z0-9]{1,7}$/：2–8 字符，此处固定 8
      description: "看板、任务面板和独立详情页的隔离测试",
      color: "BLUE",
    },
  });
  
  if (!projectRes.ok()) {
    throw new Error(`创建项目失败：HTTP ${projectRes.status()} ${await projectRes.text()}`);
  }
  
  // 响应为统一信封 { data, meta }，真实实体在 data 字段内（docs/05 §3）。
  const projectData = (await projectRes.json()) as { data: { id: string } };
  const projectId = projectData.data.id;
  
  // 2) 创建任务
  const taskRes = await request.post(`${origin}/api/v1/projects/${projectId}/tasks`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() }, // 新幂等键
    data: {
      title: "UI 测试任务",
      description: "用于验证任务详情交互",
      priority: "MEDIUM",
      status: "TODO",
    },
  });
  
  if (!taskRes.ok()) {
    throw new Error(`创建任务失败：HTTP ${taskRes.status()} ${await taskRes.text()}`);
  }
  
  const taskData = (await taskRes.json()) as { data: { id: string } };
  const taskId = taskData.data.id;
  
  return { projectId, taskId };
}
