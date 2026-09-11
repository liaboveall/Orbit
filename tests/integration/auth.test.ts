import { afterAll, beforeAll, describe, expect, it } from "vitest";
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { parseEnv } from "@/server/env";
import { createAuth } from "@/server/auth/options";
import { UserSchema } from "@/contracts";

/**
 * 认证与数据库基础集成测试（M1 / ORB-004）。
 *
 * 在**独立测试库 orbit_test**（TEST_DATABASE_URL，已由 prisma migrate deploy 建表）上做真实断言：
 *  - 迁移后的认证 schema 存在（User/Session/Account/Verification + User.timezone 扩展列）。
 *  - Better Auth server API 创建用户 + 建立数据库会话；未验证邮箱被拒。
 *  - 会话失效（撤销/过期后 getSession 返回 null）。
 *  - 会话隔离（A 的会话查不到 B）。
 *  - 响应/日志无凭证输出（Account 存哈希而非明文；会话用户对象不含 password；契约 DTO 拒绝越权字段）。
 *
 * 不使用 better-auth 的 vitest 插件 / test-client（其 peer 要求 vitest ^2||^3||^4，本项目为 5.0.0）；
 * 改为直接调用 Better Auth 官方 server API（auth.api.*）建立夹具会话（docs/06 M1 完成条件）。
 * 测试用独立 Prisma 客户端 + createAuth 工厂绑定 orbit_test，绝不复用应用单例（避免污染 orbit_dev）。
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);

/** 仅供测试的固定密钥（≥32），非任何真实凭证；应用密钥来自 .env.local 且不提交。 */
const TEST_SECRET = "orbit-integration-test-secret-0123456789";

/** 每次运行唯一的标记，保证测试邮箱不冲突且可精确清理。 */
const RUN_TAG = `orb004-${Date.now()}`;
const domain = "orbit.test";
const EMAIL_A = `${RUN_TAG}-a@${domain}`;
const EMAIL_B = `${RUN_TAG}-b@${domain}`;
const EMAIL_UNVERIFIED = `${RUN_TAG}-u@${domain}`;
const PASSWORD = "Str0ng!Passw0rd-OrbitTest"; // ≥12 位，满足 minPasswordLength

const adapter = new PrismaPg({ connectionString: env.TEST_DATABASE_URL });
const testPrisma = new PrismaClient({ adapter });
// APP_ENV:"test" 关闭 Better Auth 内置限流（本文件多次 signIn/signUp，避免命中默认阈值触发 429）。
const testAuth = createAuth(testPrisma, {
  ...env,
  APP_ENV: "test",
  BETTER_AUTH_SECRET: TEST_SECRET,
});

/** 捕获 console.info 输出（用于断言占位邮件日志不泄露凭证）。 */
const capturedLogs: string[] = [];
async function captureInfo<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.info;
  console.info = (...args: unknown[]) => {
    capturedLogs.push(args.map((a) => String(a)).join(" "));
  };
  try {
    return await fn();
  } finally {
    console.info = original;
  }
}

/**
 * 登录并返回会话 cookie 头与 session token。
 * cookie 名称不做硬编码假设，直接取 Set-Cookie 的 name=value 部分；
 * token 取自响应体（用于 revokeSession）。
 */
async function signIn(
  email: string,
  password: string,
): Promise<{ cookie: string; token: string }> {
  const res = await testAuth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter((c) => c.length > 0)
    .join("; ");
  const body = (await res.json()) as { token?: string };
  return { cookie, token: body.token ?? "" };
}

/** 用 cookie 头查询会话。 */
function sessionWith(cookie: string) {
  return testAuth.api.getSession({ headers: new Headers({ cookie }) });
}

/** 注册 → 直接置为已验证（模拟点击验证邮件链接后的状态）→ 可登录。 */
async function signUpVerified(email: string, name: string): Promise<string> {
  await testAuth.api.signUpEmail({ body: { email, password: PASSWORD, name } });
  await testPrisma.user.update({ where: { email }, data: { emailVerified: true } });
  return email;
}

beforeAll(async () => {
  // 幂等起点：清掉本 RUN_TAG 的任何残留（正常首次运行为空）。
  await testPrisma.user.deleteMany({ where: { email: { contains: RUN_TAG } } });
});

afterAll(async () => {
  // 清理夹具：删除用户级联 Session/Account；Verification 无 FK，按 identifier 兜底清理。
  await testPrisma.user.deleteMany({ where: { email: { contains: RUN_TAG } } });
  await testPrisma.verification.deleteMany({ where: { identifier: { contains: RUN_TAG } } });
  await testPrisma.$disconnect();
});

describe("认证 schema 迁移（orbit_test 真实库）", () => {
  it("四张认证表均存在", async () => {
    const rows = await testPrisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('User', 'Session', 'Account', 'Verification')
      ORDER BY table_name`;
    expect(rows.map((r) => r.table_name)).toEqual([
      "Account",
      "Session",
      "User",
      "Verification",
    ]);
  });

  it("User 含 Orbit 业务扩展列 timezone（默认 Asia/Shanghai）", async () => {
    const cols = await testPrisma.$queryRaw<
      Array<{ column_name: string; column_default: string | null }>
    >`
      SELECT column_name, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'timezone'`;
    expect(cols).toHaveLength(1);
    expect(cols[0]?.column_default).toContain("Asia/Shanghai");
  });
});

describe("Better Auth server API：创建用户与会话", () => {
  it("signUpEmail 创建用户（emailVerified=false、timezone 默认），响应/日志不含凭证", async () => {
    capturedLogs.length = 0;
    const created = await captureInfo(() =>
      testAuth.api.signUpEmail({
        body: { email: EMAIL_UNVERIFIED, password: PASSWORD, name: "未验证用户" },
      }),
    );

    // 响应中不含明文密码（凭证仅以哈希存于 Account）。
    expect(created).toBeTruthy();
    expect(JSON.stringify(created)).not.toContain(PASSWORD);

    // 占位邮件日志不泄露凭证 / 明文邮箱（docs/03 §8：敏感字段 redact）。
    expect(capturedLogs.some((l) => l.includes(PASSWORD))).toBe(false);
    expect(capturedLogs.some((l) => l.includes(EMAIL_UNVERIFIED))).toBe(false);

    const row = await testPrisma.user.findUnique({ where: { email: EMAIL_UNVERIFIED } });
    expect(row).not.toBeNull();
    expect(row?.emailVerified).toBe(false);
    expect(row?.timezone).toBe("Asia/Shanghai");
  });

  it("未验证邮箱时 signInEmail 被拒（requireEmailVerification）", async () => {
    await expect(
      testAuth.api.signInEmail({ body: { email: EMAIL_UNVERIFIED, password: PASSWORD } }),
    ).rejects.toThrow();
  });

  it("验证邮箱后 signInEmail 建立数据库会话，getSession 返回同一用户", async () => {
    await signUpVerified(EMAIL_A, "用户甲");
    const { cookie } = await signIn(EMAIL_A, PASSWORD);
    expect(cookie.length).toBeGreaterThan(0);

    const session = await sessionWith(cookie);
    expect(session).not.toBeNull();
    expect(session?.user.email).toBe(EMAIL_A);

    // 会话确实落库（数据库会话，非内存/JWT-only）。
    const dbSessions = await testPrisma.session.count({ where: { userId: session?.user.id } });
    expect(dbSessions).toBeGreaterThanOrEqual(1);
  });
});

describe("会话隔离与失效", () => {
  it("A 的会话查不到 B（用户隔离）", async () => {
    await signUpVerified(EMAIL_B, "用户乙");
    const { cookie: cookieA } = await signIn(EMAIL_A, PASSWORD);
    const { cookie: cookieB } = await signIn(EMAIL_B, PASSWORD);

    const sessionA = await sessionWith(cookieA);
    const sessionB = await sessionWith(cookieB);

    expect(sessionA?.user.email).toBe(EMAIL_A);
    expect(sessionB?.user.email).toBe(EMAIL_B);
    expect(sessionA?.user.id).not.toBe(sessionB?.user.id);
  });

  it("撤销会话后 getSession 返回 null", async () => {
    const { cookie, token } = await signIn(EMAIL_B, PASSWORD);
    expect(await sessionWith(cookie)).not.toBeNull();
    expect(token.length).toBeGreaterThan(0);

    await testAuth.api.revokeSession({ body: { token }, headers: new Headers({ cookie }) });
    expect(await sessionWith(cookie)).toBeNull();
  });

  it("会话过期后 getSession 返回 null", async () => {
    const { cookie } = await signIn(EMAIL_A, PASSWORD);
    const before = await sessionWith(cookie);
    expect(before).not.toBeNull();

    // 直接把该用户所有会话置为已过期（模拟时间流逝）。
    await testPrisma.session.updateMany({
      where: { userId: before?.user.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    expect(await sessionWith(cookie)).toBeNull();
  });
});

describe("无凭证输出边界", () => {
  it("Account 存储的是密码哈希而非明文，providerId=credential", async () => {
    const user = await testPrisma.user.findUnique({ where: { email: EMAIL_A } });
    const account = await testPrisma.account.findFirst({ where: { userId: user?.id } });
    expect(account?.providerId).toBe("credential");
    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toBe(PASSWORD); // 已哈希，非明文
  });

  it("契约 UserSchema 为 strict，拒绝 password/session 等越权字段", () => {
    const base = {
      id: "user_123",
      name: "用户甲",
      email: EMAIL_A,
      emailVerified: true,
      timezone: "Asia/Shanghai",
    };
    expect(UserSchema.parse(base)).toEqual(base);
    expect(() => UserSchema.parse({ ...base, password: PASSWORD })).toThrow();
    expect(() => UserSchema.parse({ ...base, token: "session-token" })).toThrow();
  });
});
