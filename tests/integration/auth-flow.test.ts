import { cleanupAuthUsers } from "../support/auth-cleanup";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { parseEnv } from "@/server/env";
import { createAuth, createAuthOptions } from "@/server/auth/options";
import {
  DEFAULT_RETURN_TO,
  loginPathWithReturnTo,
  sanitizeReturnTo,
} from "@/lib/return-to";

/**
 * 认证全流程 + 真实邮件集成测试（M1 / ORB-005）。
 *
 * 在独立测试库 orbit_test（TEST_DATABASE_URL）+ 本地 Mailpit（SMTP localhost:25025 / API :8025）上
 * 做端到端真实断言，覆盖 docs/07 T-AUTH-01/02/03：
 *  - 注册 → 真实验证邮件投递到 Mailpit（含 Orbit 品牌与验证链接，不含密码明文）。
 *  - 未验证邮箱登录被拒（requireEmailVerification）。
 *  - 点击验证链接（verifyEmail + token）→ emailVerified=true 且按 autoSignIn 建会话。
 *  - 已验证用户登录 → 响应设置会话 cookie → getSession 返回同一用户。
 *  - 找回密码 → 真实重置邮件（指向 /auth/reset-password，含 token）→ 重设成功 → 旧会话被撤销
 *    （revokeSessionsOnPasswordReset）→ 旧密码失效、新密码可登录。
 *  - 登录失败：不存在账户 vs 密码错误返回一致状态与文案（不泄露账户存在性）。
 *  - returnTo 安全校验（拒绝绝对 URL / 协议相对 / 反斜杠 / 伪协议 / 控制字符，回退默认）。
 *  - Auth 限流：配置形状（test 关闭、development 启用 + 敏感端点 customRules）+ 实时 429。
 *
 * 与 ORB-004 的 auth.test.ts 一致：不用 better-auth 的 vitest 插件（peer 要求 vitest ^2||^3||^4），
 * 直接调用官方 server API（auth.api.*）与 HTTP handler（auth.handler）；测试用独立 Prisma 客户端 +
 * createAuth 工厂绑定 orbit_test，绝不复用应用单例。限流用 APP_ENV:"development" 的独立实例，
 * 主流程用 APP_ENV:"test"（关闭限流，避免多次登录被默认阈值打断）。
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);

/** 仅供测试的固定密钥（≥32），非任何真实凭证。 */
const TEST_SECRET = "orbit-integration-test-secret-0123456789";

/** 每次运行唯一标记：收件人唯一 → Mailpit 检索天然隔离，且可精确清理数据库夹具。 */
const RUN_TAG = `orb005-${Date.now()}`;
const domain = "orbit.test";
const EMAIL_FLOW = `${RUN_TAG}-flow@${domain}`; // 注册→验证→登录→找回→重设 全流程主角
const EMAIL_UNVERIFIED = `${RUN_TAG}-unv@${domain}`; // 未验证登录被拒
const EMAIL_GHOST = `${RUN_TAG}-ghost@${domain}`; // 从不注册：登录失败文案对照
const PASSWORD = "Str0ng!Passw0rd-OrbitTest"; // ≥12 位
const NEW_PASSWORD = "An0ther!Str0ng-OrbitPwd"; // 重设后的新密码

const MAILPIT_API = process.env.MAILPIT_API ?? "http://localhost:8025/api/v1";
const AUTH_BASE = "http://localhost:3000";

const adapter = new PrismaPg({ connectionString: env.TEST_DATABASE_URL });
const testPrisma = new PrismaClient({ adapter });
// 主流程实例：APP_ENV:"test" 关闭 Better Auth 内置限流；SMTP 配置来自 env → 真实投递 Mailpit。
const testAuth = createAuth(testPrisma, {
  ...env,
  APP_ENV: "test",
  BETTER_AUTH_SECRET: TEST_SECRET,
});

/* ── Mailpit 检索辅助 ─────────────────────────────────────────────────── */

type MailpitSummary = {
  ID: string;
  Subject: string;
  Created: string;
  To: Array<{ Address: string }>;
};
type MailpitMessage = { Subject: string; Text: string; HTML: string };

/** 取某收件人、主题含指定片段的最**新**邮件（轮询等待 SMTP 投递 + Mailpit 索引）。 */
async function waitForEmail(
  to: string,
  subjectIncludes: string,
  timeoutMs = 8000,
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  const target = to.toLowerCase();
  let lastError = "";
  while (Date.now() < deadline) {
    const res = await fetch(
      `${MAILPIT_API}/messages?query=${encodeURIComponent(`to:${to}`)}&limit=100`,
    );
    const json = (await res.json()) as { messages?: MailpitSummary[] };
    const matches = (json.messages ?? [])
      // ⚠️ Mailpit 的 `to:` 检索是分词模糊匹配：RUN_TAG 前缀相同的不同测试收件人会被一并命中，
      // 且验证邮件主题一致。必须按**精确收件人地址**复核，否则会取到别人的 token 验证错用户。
      .filter((m) => m.To.some((addr) => addr.Address.toLowerCase() === target))
      .filter((m) => m.Subject.includes(subjectIncludes))
      .sort((a, b) => (a.Created < b.Created ? 1 : -1)); // 新 → 旧
    const newest = matches[0];
    if (newest) {
      const full = await fetch(`${MAILPIT_API}/message/${newest.ID}`);
      return (await full.json()) as MailpitMessage;
    }
    lastError = `尚无精确发往 ${to} 且主题含「${subjectIncludes}」的邮件`;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`waitForEmail 超时：${lastError}`);
}

/** 从邮件正文（text/html）提取 `token=` 查询参数值。 */
function extractToken(mail: MailpitMessage): string {
  const source = `${mail.Text ?? ""}\n${mail.HTML ?? ""}`;
  const match = /[?&]token=([^&\s"'<>]+)/.exec(source);
  if (!match?.[1]) throw new Error("未能从邮件正文提取 token");
  return decodeURIComponent(match[1]);
}

/* ── 认证辅助 ─────────────────────────────────────────────────────────── */

/** 登录并返回会话 cookie 头（取 Set-Cookie 的 name=value 部分，不硬编码 cookie 名）。 */
async function signIn(email: string, password: string): Promise<string> {
  const res = await testAuth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter((c) => c.length > 0)
    .join("; ");
}

/** 用 cookie 头查询会话。 */
function sessionWith(cookie: string) {
  return testAuth.api.getSession({ headers: new Headers({ cookie }) });
}

/** 经 HTTP handler 发起 sign-in（用于断言真实 HTTP 状态/文案，而非 api 抛错）。 */
function signInViaHandler(email: string, password: string): Promise<Response> {
  return testAuth.handler(
    new Request(`${AUTH_BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: AUTH_BASE,
      },
      body: JSON.stringify({ email, password }),
    }),
  );
}

beforeAll(async () => {
  await testPrisma.user.deleteMany({ where: { email: { contains: RUN_TAG } } });
});

it("SMTP failure teardown removes unconsumed reset tokens without touching other users", async () => {
  const tag = `reset-failure-${randomUUID()}`;
  const id = randomUUID();
  const unrelatedId = randomUUID();
  let rejectedConnections = 0;
  const server = createServer((socket) => { rejectedConnections++; socket.end("421 synthetic unavailable\r\n"); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing SMTP port");
  try {
    const email = `${tag}@orbit.test`;
    await testPrisma.user.create({ data: { id, email, name: "failure fixture", emailVerified: true } });
    await testPrisma.verification.create({ data: {
      id: unrelatedId, identifier: `reset-password:${randomUUID()}`,
      value: randomUUID(), expiresAt: new Date(Date.now() + 60000),
    } });
    const failingAuth = createAuth(testPrisma, {
      ...env, APP_ENV: "test", SMTP_HOST: "127.0.0.1", SMTP_PORT: address.port, SMTP_SECURE: false,
    });
    // Better Auth deliberately returns the same success envelope on delivery failure.
    await expect(failingAuth.api.requestPasswordReset({ body: { email } })).resolves.toMatchObject({ status: true });
    expect(rejectedConnections).toBe(1);
    expect(await testPrisma.verification.count({ where: { value: id } })).toBe(1);
    await cleanupAuthUsers(testPrisma, tag);
    expect(await testPrisma.verification.count({ where: { value: id } })).toBe(0);
    expect(await testPrisma.user.count({ where: { id } })).toBe(0);
    expect(await testPrisma.verification.count({ where: { id: unrelatedId } })).toBe(1);
  } finally {
    await cleanupAuthUsers(testPrisma, tag);
    await testPrisma.verification.deleteMany({ where: { id: unrelatedId } });
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

afterAll(async () => {
  await cleanupAuthUsers(testPrisma, RUN_TAG);
  await testPrisma.$disconnect();
});

/* ── 1. returnTo 安全校验（防开放重定向）────────────────────────────────── */

describe("returnTo 安全校验（防开放重定向）", () => {
  it("接受同源相对路径并保留 search/hash", () => {
    expect(sanitizeReturnTo("/app/today")).toBe("/app/today");
    expect(sanitizeReturnTo("/app/projects/abc/board?tab=doing#top")).toBe(
      "/app/projects/abc/board?tab=doing#top",
    );
  });

  it("拒绝绝对 URL / 协议相对 / 反斜杠 / 伪协议，回退默认落地页", () => {
    const malicious = [
      "https://evil.com",
      "http://evil.com/app",
      "//evil.com",
      "/\\evil.com",
      "\\\\evil.com",
      "javascript:alert(1)",
      "data:text/html;base64,x",
      "https:/evil.com",
      "ftp://evil.com",
    ];
    for (const bad of malicious) {
      expect(sanitizeReturnTo(bad), `应拒绝：${bad}`).toBe(DEFAULT_RETURN_TO);
    }
  });

  it("拒绝控制字符/换行注入（防重定向/头注入）", () => {
    expect(sanitizeReturnTo("/app/today\nSet-Cookie: evil=1")).toBe(DEFAULT_RETURN_TO);
    expect(sanitizeReturnTo("/app/\u0000today")).toBe(DEFAULT_RETURN_TO);
  });

  it("空/非字符串回退默认；loginPathWithReturnTo 编码合法路径且净化非法路径", () => {
    expect(sanitizeReturnTo("")).toBe(DEFAULT_RETURN_TO);
    expect(sanitizeReturnTo(null)).toBe(DEFAULT_RETURN_TO);
    expect(loginPathWithReturnTo("/app/today")).toBe("/auth/login?returnTo=%2Fapp%2Ftoday");
    expect(loginPathWithReturnTo("https://evil.com")).toBe(
      `/auth/login?returnTo=${encodeURIComponent(DEFAULT_RETURN_TO)}`,
    );
  });
});

/* ── 2. 限流配置形状 ────────────────────────────────────────────────────── */

describe("Auth 限流配置（Better Auth 内置 rateLimit）", () => {
  it("development 启用限流并为敏感端点配置 customRules；test 关闭", () => {
    const dev = createAuthOptions(testPrisma, {
      ...env,
      APP_ENV: "development",
      BETTER_AUTH_SECRET: TEST_SECRET,
    });
    expect(dev.rateLimit?.enabled).toBe(true);
    expect(dev.rateLimit?.storage).toBe("memory");
    expect(dev.rateLimit?.customRules?.["/sign-in/email"]).toEqual({ window: 60, max: 10 });
    expect(dev.rateLimit?.customRules?.["/request-password-reset"]).toEqual({
      window: 60,
      max: 5,
    });

    const test = createAuthOptions(testPrisma, {
      ...env,
      APP_ENV: "test",
      BETTER_AUTH_SECRET: TEST_SECRET,
    });
    expect(test.rateLimit?.enabled).toBe(false);
  });
});

/* ── 3. 注册 → 验证邮件 → 验证 → 会话 ──────────────────────────────────── */

describe("注册与邮箱验证流程（真实邮件经 Mailpit）", () => {
  it("signUpEmail 触发真实验证邮件：含 Orbit 品牌与验证链接，不含密码明文，用户未验证", async () => {
    await testAuth.api.signUpEmail({
      body: { email: EMAIL_FLOW, password: PASSWORD, name: "流程用户" },
    });

    const mail = await waitForEmail(EMAIL_FLOW, "验证你的 Orbit 邮箱");
    const body = `${mail.Text ?? ""}${mail.HTML ?? ""}`;
    expect(mail.Subject).toContain("Orbit");
    expect(body).toContain("Orbit");
    expect(body).toContain("/api/auth/verify-email"); // Better Auth 内置验证端点
    expect(body).toContain("callbackURL"); // 覆写为应用自有 /auth/verify
    expect(body).not.toContain(PASSWORD); // 绝不含密码明文

    const row = await testPrisma.user.findUnique({ where: { email: EMAIL_FLOW } });
    expect(row?.emailVerified).toBe(false);
    expect(row?.timezone).toBe("Asia/Shanghai");
  }, 20000);

  it("未验证邮箱 signInEmail 被拒（requireEmailVerification，且不签发会话 cookie）", async () => {
    await testAuth.api.signUpEmail({
      body: { email: EMAIL_UNVERIFIED, password: PASSWORD, name: "未验证用户" },
    });
    const res = await testAuth.api.signInEmail({
      body: { email: EMAIL_UNVERIFIED, password: PASSWORD },
      asResponse: true,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    // 未验证用户拿不到会话 cookie（→ 天然被 proxy 的 /app/* 门禁挡在外）。
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0] ?? "")
      .filter((c) => /session_token/.test(c))
      .join("; ");
    expect(cookie).toBe("");
  }, 20000);

  it("verifyEmail(token) 后 emailVerified=true 且按 autoSignInAfterVerification 建会话", async () => {
    const mail = await waitForEmail(EMAIL_FLOW, "验证你的 Orbit 邮箱");
    const token = extractToken(mail);
    expect(token.length).toBeGreaterThan(0);

    // 模拟点击邮件链接：GET /api/auth/verify-email?token=…
    await testAuth.api.verifyEmail({ query: { token } });

    const row = await testPrisma.user.findUnique({ where: { email: EMAIL_FLOW } });
    expect(row?.emailVerified).toBe(true);
    const sessions = await testPrisma.session.count({ where: { userId: row?.id } });
    expect(sessions).toBeGreaterThanOrEqual(1);
  }, 20000);

  it("验证 token 防伪造与防重放：伪造 token 被拒，已验证用户重放不新增会话（docs/07 T-AUTH-02）", async () => {
    const email = `${RUN_TAG}-verify-replay@${domain}`;
    await testAuth.api.signUpEmail({
      body: { email, password: PASSWORD, name: "重放验证用户" },
    });
    const mail = await waitForEmail(email, "验证你的 Orbit 邮箱");
    const token = extractToken(mail);

    // 首次消费 → 成功（emailVerified 置真，autoSignIn 建一个会话）。
    const first = await testAuth.api.verifyEmail({ query: { token }, asResponse: true });
    expect(first.status).toBeLessThan(400);
    const row = await testPrisma.user.findUnique({ where: { email } });
    expect(row?.emailVerified).toBe(true);
    const sessionsAfterFirst = await testPrisma.session.count({ where: { userId: row?.id } });
    expect(sessionsAfterFirst).toBeGreaterThanOrEqual(1);

    // 伪造/篡改 token（无效签名）→ 必须被拒（无 callbackURL 时抛 UNAUTHORIZED，asResponse 得 401）。
    const forged = await testAuth.api.verifyEmail({ query: { token: `${token}x` }, asResponse: true });
    expect(forged.status).toBeGreaterThanOrEqual(400);

    // 重放合法 token：better-auth@1.7.3 的邮箱验证 token 是无状态签名 JWT（非数据库 consume-once 行），
    // 对「已验证用户」幂等：早返回不新建会话。故单次使用由签名 + 过期(exp) 保证，而非消费删除；
    // 数据库 consume-once 语义见下方「密码找回与重设」中的重置 token 单次使用/过期用例。
    const replay = await testAuth.api.verifyEmail({ query: { token }, asResponse: true });
    expect(replay.status).toBeLessThan(400);
    const sessionsAfterReplay = await testPrisma.session.count({ where: { userId: row?.id } });
    expect(sessionsAfterReplay).toBe(sessionsAfterFirst); // 重放不新增会话
  }, 20000);
});

/* ── 4. 登录 → cookie → 会话 ───────────────────────────────────────────── */

describe("已验证用户登录建立数据库会话", () => {
  it("signInEmail 成功，响应设置会话 cookie，getSession 返回同一用户", async () => {
    const cookie = await signIn(EMAIL_FLOW, PASSWORD);
    expect(cookie).toContain("session_token");

    const session = await sessionWith(cookie);
    expect(session?.user.email).toBe(EMAIL_FLOW);
    expect(session?.user.emailVerified).toBe(true);

    const dbSessions = await testPrisma.session.count({ where: { userId: session?.user.id } });
    expect(dbSessions).toBeGreaterThanOrEqual(1);
  }, 20000);
});

/* ── 5. 找回密码 → 重置邮件 → 重设 → 旧会话失效 ────────────────────────── */

describe("密码找回与重设（真实邮件 + 撤销既有会话）", () => {
  it("重置邮件指向 /auth/reset-password 含 token；重设后旧会话失效、旧密码失效、新密码可登录", async () => {
    // 既有会话（稍后验证被撤销）
    const oldCookie = await signIn(EMAIL_FLOW, PASSWORD);
    expect(await sessionWith(oldCookie)).not.toBeNull();

    // 请求找回：服务端投递真实重置邮件
    await testAuth.api.requestPasswordReset({ body: { email: EMAIL_FLOW } });
    const mail = await waitForEmail(EMAIL_FLOW, "重设你的 Orbit 密码");
    const body = `${mail.Text ?? ""}${mail.HTML ?? ""}`;
    expect(body).toContain("/auth/reset-password");
    expect(body).not.toContain(PASSWORD);
    expect(body).not.toContain(NEW_PASSWORD);
    const token = extractToken(mail);

    // 重设密码（模拟 /auth/reset-password 页收集新密码后 POST /reset-password）
    await testAuth.api.resetPassword({ body: { newPassword: NEW_PASSWORD, token } });

    // 交付物 #8：旧会话被撤销（revokeSessionsOnPasswordReset）
    expect(await sessionWith(oldCookie)).toBeNull();

    // 旧密码失效、新密码可登录
    const oldPwRes = await testAuth.api.signInEmail({
      body: { email: EMAIL_FLOW, password: PASSWORD },
      asResponse: true,
    });
    expect(oldPwRes.status).toBeGreaterThanOrEqual(400);

    const newCookie = await signIn(EMAIL_FLOW, NEW_PASSWORD);
    const session = await sessionWith(newCookie);
    expect(session?.user.email).toBe(EMAIL_FLOW);
  }, 30000);

  it("重置 token 单次使用：消费后重放必须失败（docs/07 T-AUTH-02）", async () => {
    const email = `${RUN_TAG}-reset-replay@${domain}`;
    await testAuth.api.signUpEmail({
      body: { email, password: PASSWORD, name: "重放重置用户" },
    });
    await testAuth.api.requestPasswordReset({ body: { email } });
    const mail = await waitForEmail(email, "重设你的 Orbit 密码");
    const token = extractToken(mail);

    // 首次重设 → 成功。
    const first = await testAuth.api.resetPassword({
      body: { newPassword: NEW_PASSWORD, token },
      asResponse: true,
    });
    expect(first.status).toBeLessThan(400);

    // 重放同一 token → 必须 ≥400（verification 行已被 consumeVerificationValue 删除）。
    const replay = await testAuth.api.resetPassword({
      body: { newPassword: NEW_PASSWORD, token },
      asResponse: true,
    });
    expect(replay.status).toBeGreaterThanOrEqual(400);
  }, 30000);

  it("过期 token 不可使用（数据库将 Verification.expiresAt 改为过去）", async () => {
    const email = `${RUN_TAG}-reset-expired@${domain}`;
    await testAuth.api.signUpEmail({
      body: { email, password: PASSWORD, name: "过期重置用户" },
    });
    await testAuth.api.requestPasswordReset({ body: { email } });
    const mail = await waitForEmail(email, "重设你的 Orbit 密码");
    const token = extractToken(mail);

    // 直接把该 token 的 verification 行 expiresAt 改为过去。
    // identifier 明文存储为 `reset-password:<token>`（options.ts 未配 verification.storeIdentifier）。
    const updated = await testPrisma.verification.updateMany({
      where: { identifier: `reset-password:${token}` },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    expect(updated.count).toBe(1);

    // 用过期 token 重设 → 必须 ≥400（consumeVerificationValue 检到 expiresAt < now 返回 null）。
    const res = await testAuth.api.resetPassword({
      body: { newPassword: NEW_PASSWORD, token },
      asResponse: true,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  }, 30000);
});

/* ── 6. 登录失败不泄露账户存在性 ───────────────────────────────────────── */

describe("登录失败文案不泄露账户存在性", () => {
  it("不存在账户与密码错误返回一致的 HTTP 状态与文案", async () => {
    const wrongPw = await signInViaHandler(EMAIL_FLOW, "WrongPassword-12345");
    const ghost = await signInViaHandler(EMAIL_GHOST, PASSWORD);

    expect(wrongPw.status).toBe(401);
    expect(ghost.status).toBe(401);

    const wrongBody = await wrongPw.text();
    const ghostBody = await ghost.text();
    // 两种失败返回完全一致的信封（Better Auth 统一「邮箱或密码错误」文案，防账户枚举）。
    expect(ghostBody).toBe(wrongBody);
    const lower = ghostBody.toLowerCase();
    expect(lower).not.toContain("not found");
    expect(ghostBody).not.toContain("不存在");
    expect(ghostBody).not.toContain(EMAIL_GHOST);
  }, 20000);
});

/* ── 7. 实时限流 429 ───────────────────────────────────────────────────── */

describe("Auth 限流实时行为（Better Auth 内置）", () => {
  it("超过阈值后 sign-in 端点返回 429 并带 Retry-After 类头", async () => {
    // 独立实例：development（限流启用）+ 全新内存计数；唯一测试 IP（TEST-NET-3 保留段）。
    const rlAuth = createAuth(testPrisma, {
      ...env,
      APP_ENV: "development",
      BETTER_AUTH_SECRET: TEST_SECRET,
    });
    const ip = `203.0.113.${(Date.now() % 200) + 1}`;

    let saw429 = false;
    let retryAfter: string | null = null;
    for (let i = 0; i < 14; i++) {
      const res = await rlAuth.handler(
        new Request(`${AUTH_BASE}/api/auth/sign-in/email`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: AUTH_BASE,
            "x-forwarded-for": ip,
          },
          body: JSON.stringify({ email: EMAIL_GHOST, password: "whatever-12345" }),
        }),
      );
      if (res.status === 429) {
        saw429 = true;
        retryAfter =
          res.headers.get("x-retry-after") ?? res.headers.get("retry-after");
        break;
      }
    }
    expect(saw429).toBe(true);
    expect(retryAfter).not.toBeNull();
  }, 30000);
});


describe("M1 复核：认证入口资料校验", () => {
  function post(path: string, body: Record<string, unknown>, cookie = "") {
    return testAuth.handler(new Request(`${AUTH_BASE}/api/auth/${path}`, {
      method: "POST", headers: { "content-type": "application/json", origin: AUTH_BASE, cookie },
      body: JSON.stringify(body),
    }));
  }
  it.each(["   ", "x".repeat(41)])("拒绝非法注册姓名 %s", async (name) => {
    const email = `${RUN_TAG}-invalid-${name.length}@${domain}`;
    const response = await post("sign-up/email", { email, password: PASSWORD, name });
    expect(response.status).toBe(400);
    expect(await testPrisma.user.findUnique({ where: { email } })).toBeNull();
  });
  it.each([
    ["America/New_York", "America/New_York"],
    ["asia/tokyo", "Asia/Tokyo"],
    ["Invalid/Zone", "Asia/Shanghai"],
    [undefined, "Asia/Shanghai"],
  ])("注册时区 %s 归一化为 %s", async (timezone, expected) => {
    const email = `${RUN_TAG}-tz-${expected.toLowerCase().replaceAll("/", "-")}-${timezone === undefined ? "missing" : String(timezone).length}@${domain}`;
    const response = await post("sign-up/email", { email, password: PASSWORD, name: "  注册用户  ", timezone });
    expect(response.status).toBe(200);
    const user = await testPrisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.name).toBe("注册用户");
    expect(user.timezone).toBe(expected);
  });
  it("update-user 不得绕过姓名及时区校验，重新登录保留设置", async () => {
    const email = `${RUN_TAG}-update@${domain}`;
    await post("sign-up/email", { email, password: PASSWORD, name: "原姓名" });
    await testPrisma.user.update({ where: { email }, data: { emailVerified: true } });
    const cookie = await signIn(email, PASSWORD);
    for (const body of [{ name: "x".repeat(41) }, { name: "   " }, { timezone: "Invalid/Zone" }]) {
      expect((await post("update-user", body, cookie)).status).toBe(400);
      expect(await sessionWith(cookie)).not.toBeNull();
    }
    expect((await testPrisma.user.findUniqueOrThrow({ where: { email } })).name).toBe("原姓名");
    expect((await post("update-user", { name: `  ${"字".repeat(40)}  `, timezone: "Asia/Tokyo" }, cookie)).status).toBe(200);
    const user = await testPrisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.name).toHaveLength(40);
    expect(user.timezone).toBe("Asia/Tokyo");
    const nextSession = await sessionWith(await signIn(email, PASSWORD));
    expect(nextSession?.user.timezone).toBe("Asia/Tokyo");
  });
});
