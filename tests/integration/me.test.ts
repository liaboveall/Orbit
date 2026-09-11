import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import {
  ErrorResponseSchema,
  SuccessResponseSchema,
  UserSchema,
  type ErrorResponse,
  type UserDTO,
} from "@/contracts";
import { getEnv, parseEnv } from "@/server/env";
import { DomainError, NO_STORE } from "@/server/http/errors";
import { REQUEST_ID_HEADER } from "@/server/http/request-id";
import { TIMEZONE_INVALID_MESSAGE } from "@/server/me/timezone";

/**
 * `/api/v1/me` 集成测试（M1 / ORB-006：个人设置与缓存清理）。
 *
 * 在**独立测试库 orbit_test**（TEST_DATABASE_URL）上做真实断言，直接调用 Next.js route
 * handler（`GET` / `PATCH`）而非起 HTTP 服务 —— handler 是纯 `(Request) => Response` 函数，
 * 这样既能覆盖真实路由层编排（请求 ID → Origin → 会话 → schema → 领域服务 → 信封），
 * 又不引入端口/进程编排的不确定性。
 *
 * ⚠️ 单例隔离方式（与 auth.test.ts / auth-flow.test.ts 的「独立客户端 + createAuth」不同，
 * 因为本文件测的是**应用单例本身**编排出的 route handler）：
 *  - `vi.mock("@/server/db/prisma")` 把 Prisma 单例换成绑定 TEST_DATABASE_URL 的客户端，
 *    handler 与领域服务（read-user / update-user）因此读写 orbit_test，绝不触碰 orbit_dev。
 *    这里**不能**改 `process.env.DATABASE_URL = TEST_DATABASE_URL`：env 校验有一条
 *    「TEST_DATABASE_URL 必须独立于开发/生产库」的硬规则，两者同名会直接校验失败。
 *  - `APP_ENV="test"` 关闭 Better Auth 内置限流（本文件数十次 getSession/signIn，
 *    development 下会命中 /sign-in/email 等 customRules 阈值触发 429）。
 *  - 会话夹具用**同一个** `auth` 单例的 `auth.api.*` 创建：cookie 由同一 BETTER_AUTH_SECRET
 *    签发，handler 内部的 `getSession` 才能解出会话（换用另一实例会因密钥不同而始终 401）。
 *  - 上述覆写必须在**动态 import** 之前完成（静态 import 会先于模块体求值，那时单例已定型）。
 *
 * 覆盖验收标准：
 *  #1 姓名/时区持久化（PATCH 后 GET 返回新值，且直查库立即可见）
 *  #2 非法时区 400 VALIDATION_ERROR + fieldErrors.timezone 且不落库
 *  #3 所有 /me 响应 `Cache-Control: private, no-store`；撤销会话后立即失去访问权；账户隔离
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);

/** 仅供测试的固定密钥（≥32），非任何真实凭证。 */
const TEST_SECRET = "orbit-integration-test-secret-0123456789";

/* ── 环境覆写：关闭限流 + 固定测试密钥（必须在动态 import 前）────────────── */
process.env.APP_ENV = "test";
process.env.BETTER_AUTH_SECRET = TEST_SECRET;
getEnv(true); // 刷新模块级缓存，使随后 import 的单例读到上述覆写

/**
 * 把应用 Prisma 单例替换为绑定 orbit_test 的客户端。
 * 工厂是惰性的：在首次 import `@/server/db/prisma` 时才执行，此时 dotenv 已加载完毕。
 */
vi.mock("@/server/db/prisma", async () => {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { parseEnv: parseTestEnv } = await import("@/server/env");
  const testEnv = parseTestEnv(process.env as Record<string, string | undefined>);
  const adapter = new PrismaPg({ connectionString: testEnv.TEST_DATABASE_URL });
  return { prisma: new PrismaClient({ adapter }) };
});

/* ── 动态 import（必须在环境覆写与 vi.mock 注册之后）────────────────────── */
const { GET, PATCH } = await import("@/app/api/v1/me/route");
const { auth } = await import("@/server/auth");
/** 夹具/断言用客户端：与 handler 内部同一个（同指 orbit_test），不会出现「断言读到另一份数据」。 */
const { prisma: testPrisma } = await import("@/server/db/prisma");
const { buildUserUpdateData } = await import("@/server/me/update-user");
const { accountNotFoundError, readUserById, toUserDto } = await import("@/server/me/read-user");

/* ── 夹具 ─────────────────────────────────────────────────────────────── */

const RUN_TAG = `orb006-${Date.now()}`;
const domain = "orbit.test";
const EMAIL_A = `${RUN_TAG}-a@${domain}`; // 主账户：读写 /me
const EMAIL_B = `${RUN_TAG}-b@${domain}`; // 对照账户：验证隔离
const PASSWORD = "Str0ng!Passw0rd-OrbitTest"; // ≥12 位，满足 minPasswordLength
const NAME_A = "用户甲";
const NAME_B = "用户乙";

const ME_URL = `${env.BETTER_AUTH_URL}/api/v1/me`;
/** 取白名单首个可信源（env 校验已保证非空、无通配符），不硬编码端口。 */
const TRUSTED_ORIGIN =
  env.AUTH_TRUSTED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0] ?? env.BETTER_AUTH_URL;

/** GET/PATCH 成功信封（strict）：data 必须是合法 User，meta 必须含 requestId。 */
const MeSuccessSchema = SuccessResponseSchema(UserSchema);

/* ── 请求与信封辅助 ───────────────────────────────────────────────────── */

type MeRequestOptions = {
  method?: "GET" | "PATCH";
  /** null/undefined = 不带 cookie（未认证）。 */
  cookie?: string | null;
  /** 结构化请求体（会被 JSON.stringify）。 */
  body?: unknown;
  /** 原始请求体文本（测空体 / 非 JSON）；优先级高于 body。 */
  rawBody?: string;
  /** null = 不带 Origin 头；缺省用可信源。 */
  origin?: string | null;
  /** 上游传入的 x-request-id（测链路连续性与清洗）。 */
  requestId?: string;
};

function meRequest(options: MeRequestOptions = {}): Request {
  const {
    cookie = null,
    body,
    rawBody,
    origin = TRUSTED_ORIGIN,
    requestId,
  } = options;

  const hasBody = rawBody !== undefined || body !== undefined;
  // method 可显式指定；缺省时按「有无请求体」推断（PATCH 带体、GET 不带），
  // 避免每个用例重复写 method；下方守卫则杜绝「GET 却带了体」的误用。
  const method = options.method ?? (hasBody ? "PATCH" : "GET");
  if (method === "GET" && hasBody) {
    throw new Error("测试助手误用：GET /me 不应携带请求体");
  }

  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (origin !== null) headers.set("origin", origin);
  if (requestId) headers.set(REQUEST_ID_HEADER, requestId);

  const init: RequestInit = { method, headers };
  if (rawBody !== undefined) {
    headers.set("content-type", "application/json");
    init.body = rawBody;
  } else if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  return new Request(ME_URL, init);
}

/** 解析并**严格校验**成功信封（形状不合契约时直接抛错，测试失败得明确）。 */
async function readSuccess(response: Response): Promise<UserDTO & { requestId: string }> {
  const json: unknown = await response.json();
  const parsed = MeSuccessSchema.parse(json);
  return { ...parsed.data, requestId: parsed.meta.requestId };
}

/** 解析并严格校验错误信封。 */
async function readError(response: Response): Promise<ErrorResponse> {
  const json: unknown = await response.json();
  return ErrorResponseSchema.parse(json);
}

/** 断言响应带私有缓存策略（AC-3）并返回其值，便于逐用例复核。 */
function cacheControlOf(response: Response): string | null {
  return response.headers.get("cache-control");
}

/* ── 认证夹具 ─────────────────────────────────────────────────────────── */

/** 注册 → 直接置为已验证（跳过邮件往返）→ 可登录。 */
async function signUpVerified(email: string, name: string): Promise<void> {
  await auth.api.signUpEmail({ body: { email, password: PASSWORD, name } });
  await testPrisma.user.update({ where: { email }, data: { emailVerified: true } });
}

/** 登录并返回会话 cookie 头与 session token（不硬编码 cookie 名）。 */
async function signIn(email: string): Promise<{ cookie: string; token: string }> {
  const res = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
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

/** 捕获领域错误（服务层断言用）：不抛错或抛非 DomainError 都算失败。 */
async function captureDomainError(fn: () => unknown): Promise<DomainError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error("预期抛出 DomainError，但调用正常返回");
}

let cookieA = "";
let cookieB = "";
let userAId = "";

beforeAll(async () => {
  // 幂等起点：清掉本 RUN_TAG 的任何残留（正常首次运行为空）。
  await testPrisma.user.deleteMany({ where: { email: { contains: RUN_TAG } } });

  // signUpEmail 会经 nodemailer 向本地 Mailpit 投递真实验证邮件，耗时高于纯库操作。
  await signUpVerified(EMAIL_A, NAME_A);
  await signUpVerified(EMAIL_B, NAME_B);
  const sessionA = await signIn(EMAIL_A);
  const sessionB = await signIn(EMAIL_B);
  cookieA = sessionA.cookie;
  cookieB = sessionB.cookie;
  expect(cookieA).toContain("session_token");
  expect(cookieB).toContain("session_token");

  const row = await testPrisma.user.findUniqueOrThrow({ where: { email: EMAIL_A } });
  userAId = row.id;
}, 60_000);

afterAll(async () => {
  await testPrisma.user.deleteMany({ where: { email: { contains: RUN_TAG } } });
  await testPrisma.verification.deleteMany({ where: { identifier: { contains: RUN_TAG } } });
  await testPrisma.$disconnect();
});

/* ── 1. GET /me 认证边界 ──────────────────────────────────────────────── */

describe("GET /me：认证边界", () => {
  it("未认证 → 401 UNAUTHENTICATED（统一信封，不带任何账户数据）", async () => {
    const response = await GET(meRequest());
    expect(response.status).toBe(401);

    const envelope = await readError(response);
    expect(envelope.error.code).toBe("UNAUTHENTICATED");
    expect(envelope.error.message.length).toBeGreaterThan(0);
    expect(envelope.error.fieldErrors).toBeUndefined();
    expect(envelope.meta.requestId.length).toBeGreaterThan(0);
    // 未认证响应也不得含 data 键（strict 信封已保证，这里再固化一次）。
    expect(Object.keys(envelope)).toEqual(["error", "meta"]);
    expect(cacheControlOf(response)).toBe(NO_STORE);
  });

  it("伪造/无效会话 cookie → 401，且不回显任何账户信息", async () => {
    const response = await GET(meRequest({ cookie: "better-auth.session_token=forged-token" }));
    expect(response.status).toBe(401);

    const envelope = await readError(response);
    expect(envelope.error.code).toBe("UNAUTHENTICATED");
    const text = JSON.stringify(envelope);
    expect(text).not.toContain(EMAIL_A);
    expect(text).not.toContain(NAME_A);
    expect(text).not.toContain("forged-token");
  });

  it("他人会话 cookie 只能读到该会话对应的账户（不可越权读 A）", async () => {
    const response = await GET(meRequest({ cookie: cookieB }));
    expect(response.status).toBe(200);
    const data = await readSuccess(response);
    expect(data.email).toBe(EMAIL_B);
    expect(data.id).not.toBe(userAId);
  });
});

/* ── 2. GET /me 已认证：契约形状与响应头 ──────────────────────────────── */

describe("GET /me：已认证返回权威账户档案", () => {
  it("200 + 严格信封，data 与数据库当前行一致（timezone 默认 Asia/Shanghai）", async () => {
    const response = await GET(meRequest({ cookie: cookieA }));
    expect(response.status).toBe(200);

    const data = await readSuccess(response);
    const row = await testPrisma.user.findUniqueOrThrow({ where: { id: data.id } });
    expect(data).toEqual({
      id: row.id,
      name: row.name,
      email: EMAIL_A,
      emailVerified: true,
      timezone: row.timezone,
      requestId: data.requestId,
    });
    expect(data.name).toBe(NAME_A);
    expect(data.timezone).toBe("Asia/Shanghai"); // schema 默认值（docs/04 §3）
  });

  it("响应头：Cache-Control: private, no-store + x-request-id + JSON charset", async () => {
    const response = await GET(meRequest({ cookie: cookieA }));
    // AC-3：账户私有数据禁止任何缓存留存（成功响应同样受此约束）。
    expect(cacheControlOf(response)).toBe("private, no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-type")).toContain("utf-8");

    const requestId = response.headers.get(REQUEST_ID_HEADER);
    expect(requestId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    // 头部与信封 meta.requestId 必须同源（日志串联依赖这一点）。
    const data = await readSuccess(response);
    expect(data.requestId).toBe(requestId);
  });

  it("回显上游合法 x-request-id 以保持链路连续", async () => {
    const upstream = "orbit-edge-0123456789abcdef";
    const response = await GET(meRequest({ cookie: cookieA, requestId: upstream }));
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(upstream);
    const data = await readSuccess(response);
    expect(data.requestId).toBe(upstream);
  });

  it("拒绝回显非法 x-request-id（CRLF/控制字符/超长），改为生成新 UUID", async () => {
    const malicious = ["abc\r\nSet-Cookie: evil=1", "x".repeat(129), "id with space"];
    for (const bad of malicious) {
      // Headers 会直接拒绝含非法字符的值，故只对能构造出的值做断言。
      let request: Request;
      try {
        request = meRequest({ cookie: cookieA, requestId: bad });
      } catch {
        continue;
      }
      const response = await GET(request);
      const echoed = response.headers.get(REQUEST_ID_HEADER);
      expect(echoed).not.toBe(bad);
      expect(echoed).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    }
  });

  it("响应不含 password / 会话 token 等敏感字段", async () => {
    const response = await GET(meRequest({ cookie: cookieA }));
    const text = await response.text();
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain("password");
    expect(text).not.toContain(cookieA.split("=").pop() ?? "__never__");
    // 白名单只有 5 个字段（契约 UserSchema 为 strict）。
    const parsed = MeSuccessSchema.parse(JSON.parse(text) as unknown);
    expect(Object.keys(parsed.data).sort()).toEqual([
      "email",
      "emailVerified",
      "id",
      "name",
      "timezone",
    ]);
  });

  it("直查数据库（不依赖 Better Auth 会话快照）：绕过 /me 改库后 GET 立即可见", async () => {
    // 这是 AC-1 的根因验证：若 handler 读的是会话对象/cookie 缓存，本断言必然失败。
    const direct = "Europe/Berlin";
    await testPrisma.user.update({ where: { id: userAId }, data: { timezone: direct } });

    const response = await GET(meRequest({ cookie: cookieA }));
    const data = await readSuccess(response);
    expect(data.timezone).toBe(direct);

    // 复位，避免影响后续用例的初始值断言。
    await testPrisma.user.update({ where: { id: userAId }, data: { timezone: "Asia/Shanghai" } });
  });
});

/* ── 3. PATCH /me 正常更新 ────────────────────────────────────────────── */

describe("PATCH /me：更新姓名与时区", () => {
  it("更新 name → 200 + 返回更新后的 User，且已落库", async () => {
    const response = await PATCH(meRequest({ cookie: cookieA, body: { name: "李四" } }));
    expect(response.status).toBe(200);

    const data = await readSuccess(response);
    expect(data.name).toBe("李四");
    expect(data.email).toBe(EMAIL_A);
    expect(data.id).toBe(userAId);
    expect(cacheControlOf(response)).toBe(NO_STORE);

    const row = await testPrisma.user.findUniqueOrThrow({ where: { id: userAId } });
    expect(row.name).toBe("李四");
  });

  it("更新 timezone（合法 IANA）→ 200 + 落库", async () => {
    const response = await PATCH(
      meRequest({ cookie: cookieA, body: { timezone: "Asia/Tokyo" } }),
    );
    expect(response.status).toBe(200);
    const data = await readSuccess(response);
    expect(data.timezone).toBe("Asia/Tokyo");

    const row = await testPrisma.user.findUniqueOrThrow({ where: { id: userAId } });
    expect(row.timezone).toBe("Asia/Tokyo");
  });

  it("可同时更新 name + timezone（PATCH 部分更新语义）", async () => {
    const response = await PATCH(
      meRequest({ cookie: cookieA, body: { name: "王五", timezone: "America/New_York" } }),
    );
    expect(response.status).toBe(200);
    const data = await readSuccess(response);
    expect(data.name).toBe("王五");
    expect(data.timezone).toBe("America/New_York");
  });

  it("未提供的字段保持不变（只改 timezone 时 name 不被清空）", async () => {
    const response = await PATCH(
      meRequest({ cookie: cookieA, body: { timezone: "Asia/Singapore" } }),
    );
    expect(response.status).toBe(200);
    const data = await readSuccess(response);
    expect(data.timezone).toBe("Asia/Singapore");
    expect(data.name).toBe("王五");

    const row = await testPrisma.user.findUniqueOrThrow({ where: { id: userAId } });
    expect(row.email).toBe(EMAIL_A);
    expect(row.emailVerified).toBe(true);
  });

  it("姓名首尾空白被 trim 后入库（避免空白名通过 min(1)）", async () => {
    const response = await PATCH(meRequest({ cookie: cookieA, body: { name: "  赵六  " } }));
    expect(response.status).toBe(200);
    const data = await readSuccess(response);
    expect(data.name).toBe("赵六");

    const row = await testPrisma.user.findUniqueOrThrow({ where: { id: userAId } });
    expect(row.name).toBe("赵六");
  });

  it("AC-1 持久化：PATCH 之后 GET（同一会话 cookie）返回更新值", async () => {
    const patched = await PATCH(
      meRequest({ cookie: cookieA, body: { name: "孙七", timezone: "Asia/Kolkata" } }),
    );
    expect(patched.status).toBe(200);
    const updated = await readSuccess(patched);

    // 模拟「刷新页面」：新请求、新 requestId、同一 cookie。
    const refreshed = await GET(meRequest({ cookie: cookieA }));
    expect(refreshed.status).toBe(200);
    const current = await readSuccess(refreshed);
    expect(current.name).toBe(updated.name);
    expect(current.timezone).toBe(updated.timezone);
    expect(current.timezone).toBe("Asia/Kolkata");
    expect(current.requestId).not.toBe(updated.requestId);

    // 权威来源复核：数据库里的值就是响应里的值。
    const row = await testPrisma.user.findUniqueOrThrow({ where: { id: userAId } });
    expect(row.name).toBe("孙七");
    expect(row.timezone).toBe("Asia/Kolkata");
  });

  it("PATCH 响应同样带 private, no-store 与 x-request-id", async () => {
    const response = await PATCH(meRequest({ cookie: cookieA, body: { name: "周八" } }));
    expect(cacheControlOf(response)).toBe("private, no-store");
    const requestId = response.headers.get(REQUEST_ID_HEADER);
    expect(requestId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    const data = await readSuccess(response);
    expect(data.requestId).toBe(requestId);
  });
});

/* ── 4. PATCH /me 校验与拒绝 ──────────────────────────────────────────── */

describe("PATCH /me：输入校验（400 VALIDATION_ERROR）", () => {
  it("AC-2 非法时区 → 400 VALIDATION_ERROR + fieldErrors.timezone，且不落库", async () => {
    const before = await testPrisma.user.findUniqueOrThrow({ where: { id: userAId } });

    const response = await PATCH(
      meRequest({ cookie: cookieA, body: { timezone: "Mars/Olympus" } }),
    );
    expect(response.status).toBe(400);

    const envelope = await readError(response);
    expect(envelope.error.code).toBe("VALIDATION_ERROR");
    expect(envelope.error.fieldErrors?.timezone).toBeDefined();
    expect(envelope.error.fieldErrors?.timezone?.[0]).toBe(TIMEZONE_INVALID_MESSAGE);
    expect(cacheControlOf(response)).toBe(NO_STORE);

    // 不落库：时区仍是请求前的值。
    const after = await testPrisma.user.findUniqueOrThrow({ where: { id: userAId } });
    expect(after.timezone).toBe(before.timezone);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("其它非法时区形态同样被拒（虚构城市/裸偏移文本/多余层级）", async () => {
    for (const bad of ["Asia/Nowhere", "GMT+08:00", "UTC+8", "Asia/Shanghai/Extra"]) {
      const response = await PATCH(meRequest({ cookie: cookieA, body: { timezone: bad } }));
      expect(response.status, `应拒绝时区：${bad}`).toBe(400);
      const envelope = await readError(response);
      expect(envelope.error.code).toBe("VALIDATION_ERROR");
      expect(envelope.error.fieldErrors?.timezone).toBeDefined();
    }
  });

  it("合法 IANA 时区（含半小时/45 分钟偏移与 Etc/*）被接受", async () => {
    for (const good of ["Asia/Kathmandu", "Australia/Sydney", "Etc/GMT+8", "UTC"]) {
      const response = await PATCH(meRequest({ cookie: cookieA, body: { timezone: good } }));
      expect(response.status, `应接受时区：${good}`).toBe(200);
      const data = await readSuccess(response);
      expect(data.timezone).toBe(good);
    }
  });

  it("空对象 body → 400（minProperties:1），fieldErrors 落在根路径", async () => {
    const response = await PATCH(meRequest({ cookie: cookieA, body: {} }));
    expect(response.status).toBe(400);
    const envelope = await readError(response);
    expect(envelope.error.code).toBe("VALIDATION_ERROR");
    expect(envelope.error.fieldErrors?.["(root)"]).toBeDefined();
  });

  it("完全没有请求体 / 非 JSON 文本 → 400 VALIDATION_ERROR（不泄漏为 500）", async () => {
    const noBody = await PATCH(meRequest({ method: "PATCH", cookie: cookieA }));
    expect(noBody.status).toBe(400);
    expect((await readError(noBody)).error.code).toBe("VALIDATION_ERROR");

    const broken = await PATCH(meRequest({ cookie: cookieA, rawBody: "{not-json" }));
    expect(broken.status).toBe(400);
    expect((await readError(broken)).error.code).toBe("VALIDATION_ERROR");

    const scalar = await PATCH(meRequest({ cookie: cookieA, rawBody: '"just-a-string"' }));
    expect(scalar.status).toBe(400);
    expect((await readError(scalar)).error.code).toBe("VALIDATION_ERROR");
  });

  it("未知字段 → 400（additionalProperties:false），错误信息指名多余字段且不落库", async () => {
    const response = await PATCH(
      meRequest({ cookie: cookieA, body: { name: "吴九", nickname: "小九" } }),
    );
    expect(response.status).toBe(400);
    const envelope = await readError(response);
    expect(envelope.error.code).toBe("VALIDATION_ERROR");
    // Zod 4 的 unrecognized_keys issue 落在**根路径**（多余键不属于 schema），
    // 故 fieldErrors 键为 "(root)" 而非字段名；但 message 会指名多余键，客户端仍可提示。
    const rootErrors = envelope.error.fieldErrors?.["(root)"];
    expect(rootErrors).toBeDefined();
    expect(rootErrors?.join(" ")).toContain("nickname");

    const row = await testPrisma.user.findUniqueOrThrow({ where: { id: userAId } });
    expect(row.name).not.toBe("吴九");
  });

  it("name 超 40 字符 → 400 + fieldErrors.name；恰好 40 字符通过", async () => {
    const tooLong = await PATCH(
      meRequest({ cookie: cookieA, body: { name: "a".repeat(41) } }),
    );
    expect(tooLong.status).toBe(400);
    const envelope = await readError(tooLong);
    expect(envelope.error.code).toBe("VALIDATION_ERROR");
    expect(envelope.error.fieldErrors?.name).toBeDefined();

    const exact = await PATCH(meRequest({ cookie: cookieA, body: { name: "a".repeat(40) } }));
    expect(exact.status).toBe(200);
    expect((await readSuccess(exact)).name).toHaveLength(40);
  });

  it("空字符串 / 纯空白姓名 → 400（不允许空白名入库）", async () => {
    const empty = await PATCH(meRequest({ cookie: cookieA, body: { name: "" } }));
    expect(empty.status).toBe(400);
    expect((await readError(empty)).error.fieldErrors?.name).toBeDefined();

    const blank = await PATCH(meRequest({ cookie: cookieA, body: { name: "   " } }));
    expect(blank.status).toBe(400);
    const blankEnvelope = await readError(blank);
    expect(blankEnvelope.error.code).toBe("VALIDATION_ERROR");
    expect(blankEnvelope.error.fieldErrors?.name).toBeDefined();
  });

  it("越权字段（email / emailVerified / id）一律 400，且数据库未被改动", async () => {
    const before = await testPrisma.user.findUniqueOrThrow({ where: { id: userAId } });
    for (const body of [
      { email: `hacked-${RUN_TAG}@${domain}` },
      { emailVerified: false },
      { id: "user_2" },
      { name: "吴九", email: `hacked-${RUN_TAG}@${domain}` },
    ]) {
      const response = await PATCH(meRequest({ cookie: cookieA, body }));
      expect(response.status, `应拒绝越权写入：${JSON.stringify(body)}`).toBe(400);
      expect((await readError(response)).error.code).toBe("VALIDATION_ERROR");
    }
    const after = await testPrisma.user.findUniqueOrThrow({ where: { id: userAId } });
    expect(after.email).toBe(before.email);
    expect(after.emailVerified).toBe(before.emailVerified);
    expect(after.name).toBe(before.name);
  });

  it("未认证的 PATCH → 401（且不落库）", async () => {
    const before = await testPrisma.user.findUniqueOrThrow({ where: { id: userAId } });
    const response = await PATCH(meRequest({ body: { name: "匿名者" } }));
    expect(response.status).toBe(401);
    expect((await readError(response)).error.code).toBe("UNAUTHENTICATED");

    const after = await testPrisma.user.findUniqueOrThrow({ where: { id: userAId } });
    expect(after.name).toBe(before.name);
  });
});

/* ── 5. PATCH /me Origin 边界 ─────────────────────────────────────────── */

describe("PATCH /me：同源边界（自有变更 API）", () => {
  it("缺失 Origin 头 → 403 ORIGIN_NOT_ALLOWED，且不落库", async () => {
    const before = await testPrisma.user.findUniqueOrThrow({ where: { id: userAId } });
    const response = await PATCH(
      meRequest({ cookie: cookieA, body: { name: "跨站者" }, origin: null }),
    );
    expect(response.status).toBe(403);

    const envelope = await readError(response);
    expect(envelope.error.code).toBe("ORIGIN_NOT_ALLOWED");
    expect(cacheControlOf(response)).toBe(NO_STORE);

    const after = await testPrisma.user.findUniqueOrThrow({ where: { id: userAId } });
    expect(after.name).toBe(before.name);
  });

  it("非白名单 Origin → 403 ORIGIN_NOT_ALLOWED", async () => {
    for (const evil of ["https://evil.example.com", "http://localhost:9999"]) {
      const response = await PATCH(
        meRequest({ cookie: cookieA, body: { name: "跨站者" }, origin: evil }),
      );
      expect(response.status, `应拒绝来源：${evil}`).toBe(403);
      expect((await readError(response)).error.code).toBe("ORIGIN_NOT_ALLOWED");
    }
  });

  it("Origin 校验先于会话校验（无 cookie + 无 Origin 时先报 403）", async () => {
    // 生命周期顺序：请求 ID → Origin → 会话（docs/03 §4）。
    const response = await PATCH(meRequest({ body: { name: "x" }, origin: null }));
    expect(response.status).toBe(403);
    expect((await readError(response)).error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("GET 豁免 Origin 检查（安全方法）", async () => {
    const response = await GET(meRequest({ cookie: cookieA, origin: null }));
    expect(response.status).toBe(200);
  });
});

/* ── 6. 账户隔离与缓存（AC-3）────────────────────────────────────────── */

describe("AC-3：缓存隔离与账户隔离", () => {
  it("A 的修改不影响 B；B 仍读到自己的档案", async () => {
    await PATCH(meRequest({ cookie: cookieA, body: { name: "隔离甲", timezone: "Asia/Tokyo" } }));

    const response = await GET(meRequest({ cookie: cookieB }));
    const data = await readSuccess(response);
    expect(data.name).toBe(NAME_B);
    expect(data.email).toBe(EMAIL_B);
    expect(data.timezone).toBe("Asia/Shanghai");
  });

  it("撤销会话（退出登录）后 GET/PATCH 立即 401 —— 私有数据不可再访问", async () => {
    const { cookie, token } = await signIn(EMAIL_B);
    expect(token.length).toBeGreaterThan(0);
    expect((await GET(meRequest({ cookie }))).status).toBe(200);

    // 模拟 UserMenu 的「退出登录」：服务端 revokeSession 清除 httpOnly 会话 cookie。
    await auth.api.revokeSession({ body: { token }, headers: new Headers({ cookie }) });

    const after = await GET(meRequest({ cookie }));
    expect(after.status).toBe(401);
    expect((await readError(after)).error.code).toBe("UNAUTHENTICATED");

    const patched = await PATCH(meRequest({ cookie, body: { name: "退出后写入" } }));
    expect(patched.status).toBe(401);
    const row = await testPrisma.user.findUniqueOrThrow({ where: { email: EMAIL_B } });
    expect(row.name).toBe(NAME_B);
  }, 20_000);

  it("所有 /me 响应（200/400/401/403）都带 Cache-Control: private, no-store", async () => {
    const responses: Array<{ label: string; response: Response }> = [
      { label: "GET 200", response: await GET(meRequest({ cookie: cookieA })) },
      { label: "GET 401", response: await GET(meRequest()) },
      {
        label: "PATCH 200",
        response: await PATCH(meRequest({ cookie: cookieA, body: { name: "缓存甲" } })),
      },
      {
        label: "PATCH 400 非法时区",
        response: await PATCH(
          meRequest({ cookie: cookieA, body: { timezone: "Mars/Olympus" } }),
        ),
      },
      { label: "PATCH 400 空对象", response: await PATCH(meRequest({ cookie: cookieA, body: {} })) },
      { label: "PATCH 401", response: await PATCH(meRequest({ body: { name: "x" } })) },
      {
        label: "PATCH 403",
        response: await PATCH(
          meRequest({ cookie: cookieA, body: { name: "x" }, origin: "https://evil.example.com" }),
        ),
      },
    ];

    for (const { label, response } of responses) {
      expect(cacheControlOf(response), `${label} 缺少私有缓存策略`).toBe("private, no-store");
      expect(response.headers.get(REQUEST_ID_HEADER), `${label} 缺少 x-request-id`).toMatch(
        /^[A-Za-z0-9_-]{1,128}$/,
      );
    }
    expect([200, 401, 200, 400, 400, 401, 403]).toEqual(responses.map((r) => r.response.status));
  });
});

/* ── 7. 服务层（src/server/me）───────────────────────────────────────── */

describe("服务层：readUserById / toUserDto / buildUserUpdateData", () => {
  it("readUserById 返回契约 UserDTO；未知 id 抛 404 NOT_FOUND 领域错误", async () => {
    const dto = await readUserById(userAId);
    expect(UserSchema.parse(dto)).toEqual(dto);
    expect(dto.id).toBe(userAId);

    const error = await captureDomainError(() => readUserById("user_does-not-exist"));
    expect(error.code).toBe("NOT_FOUND");
    expect(error.status).toBe(404);
    // 不外泄数据库细节（不含 SQL / P2025 字样）。
    expect(error.message).not.toContain("P2025");
    expect(error.message).not.toContain("prisma");
    expect(accountNotFoundError().code).toBe("NOT_FOUND");
  });

  it("toUserDto 只映射白名单列（忽略 image/createdAt 等无关列）", () => {
    const dto = toUserDto({
      id: userAId,
      name: "映射用户",
      email: EMAIL_A,
      emailVerified: true,
      timezone: "Asia/Shanghai",
    });
    expect(Object.keys(dto).sort()).toEqual([
      "email",
      "emailVerified",
      "id",
      "name",
      "timezone",
    ]);
  });

  it("toUserDto 对非法身份字段仍抛错", () => {
    expect(() =>
      toUserDto({
        id: userAId,
        name: "合法姓名",
        email: "invalid-email",
        emailVerified: true,
        timezone: "Asia/Shanghai",
      }),
    ).toThrow();
  });

  it("buildUserUpdateData 白名单只产出 name/timezone，并做 trim 与 IANA 校验", () => {
    expect(buildUserUpdateData({ name: "  李四  " })).toEqual({ name: "李四" });
    expect(buildUserUpdateData({ timezone: " Asia/Tokyo " })).toEqual({ timezone: "Asia/Tokyo" });
    expect(buildUserUpdateData({ name: "李四", timezone: "Asia/Tokyo" })).toEqual({
      name: "李四",
      timezone: "Asia/Tokyo",
    });
  });

  it("buildUserUpdateData 对非法输入抛 VALIDATION_ERROR + 字段级提示（不落库）", async () => {
    const badTimezone = await captureDomainError(() =>
      buildUserUpdateData({ timezone: "Mars/Olympus" }),
    );
    expect(badTimezone.code).toBe("VALIDATION_ERROR");
    expect(badTimezone.status).toBe(400);
    expect(badTimezone.fieldErrors?.timezone?.[0]).toBe(TIMEZONE_INVALID_MESSAGE);

    const badName = await captureDomainError(() => buildUserUpdateData({ name: "a".repeat(41) }));
    expect(badName.fieldErrors?.name).toBeDefined();

    const blankName = await captureDomainError(() => buildUserUpdateData({ name: "   " }));
    expect(blankName.fieldErrors?.name).toBeDefined();

    // 两个字段同时非法 → 两条提示一并返回（一次性告知用户所有问题）。
    const both = await captureDomainError(() =>
      buildUserUpdateData({ name: "   ", timezone: "Nope/Nope" }),
    );
    expect(Object.keys(both.fieldErrors ?? {}).sort()).toEqual(["name", "timezone"]);
  });
});


describe("M1 复核：历史异常资料可恢复", () => {
  it.each(["x".repeat(41), "   "])("有效会话不因旧姓名失效，读取不改库且可显式修复", async (name) => {
    const email = `${RUN_TAG}-legacy-${name.length}@${domain}`;
    await signUpVerified(email, "正常姓名");
    const { cookie } = await signIn(email);
    await testPrisma.user.update({ where: { email }, data: { name, timezone: "Invalid/Zone" } });
    const response = await GET(meRequest({ cookie }));
    expect(response.status).toBe(200);
    const dto = await readSuccess(response);
    expect(dto.name).toBe(name.trim().slice(0, 40) || "未设置姓名");
    expect(dto.timezone).toBe("Asia/Shanghai");
    expect((await testPrisma.user.findUniqueOrThrow({ where: { email } })).name).toBe(name);
    const fixed = await PATCH(meRequest({ cookie, body: { name: "修复姓名", timezone: "Asia/Tokyo" } }));
    expect(fixed.status).toBe(200);
    expect((await readSuccess(fixed)).name).toBe("修复姓名");
    expect((await testPrisma.user.findUniqueOrThrow({ where: { email } })).timezone).toBe("Asia/Tokyo");
  });
});
