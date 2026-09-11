import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { ErrorResponseSchema } from "@/contracts";
import { getEnv, parseEnv } from "@/server/env";

/**
 * M4 收尾工作流 3：邀请限流完整性集成验证（preview + accept，真实执行限流逻辑）。
 *
 * 背景与动机：tests/integration/invitations.test.ts 覆盖邀请全流程，但没有任何一个
 * 用例真正把 preview/accept 的限流逼到 429（也没有 mock 关闭限流——之前顶部注释提到
 * 的「关闭限流」经核实实指与本文件无关的旧描述，本文件独立核实：不 mock 任何
 * rate-limit 模块，直接调用真实路由 handler，让 enforceAnonymousInviteLimit /
 * enforceWriteLimit 的真实逻辑跑满 20/60 次配额）。这里补齐：
 *  1. 超过 20/IP/分钟 → 429，body 为 RATE_LIMITED，响应头带 Retry-After；
 *  2. 窗口过后配额恢复（用极小 maxTokens 的独立限流器实例验证「过窗口后可以继续」的
 *     算法语义，避免真实等待 60s 拖慢测试——见下方 §窗口恢复 的说明）；
 *  3. 不同 IP 桶互相隔离（一个 IP 打满不影响另一个 IP）；
 *  4. accept 与 preview 共享同一个 IP 桶（同一 IP 交替调用两个端点，合计不超过 20 次，
 *     不是各自 20 次）；
 *  5. accept 同时受用户写桶约束（同一用户即使换 IP，也会撞上 60/分钟的写限额）；
 *  6. TRUSTED_PROXY_COUNT=0（未配置受信代理）时，伪造 X-Forwarded-For 对判定完全
 *     无效——所有伪造 IP 请求落进同一个固定占位桶，与真实场景一致地被合并限流，
 *     不能靠换头绕过（本文件其余用例默认把 TRUSTED_PROXY_COUNT 设为 1 以便按 IP
 *     区分桶，只有这一条用例临时切回 0，结束后立即切回，见该 describe 块）。
 *
 * §窗口恢复：docs/03 §8 的窗口是 60 秒，真实等待会让这个文件运行超过 1 分钟——
 * 用真实 route handler 验证窗口恢复的语义 без 等待 60s 是不可能的（限流器状态是
 * 模块级单例，测试无法注入假时钟）。因此本文件对「429 / Retry-After / IP 隔离 /
 * 共享桶 / 伪造头无效」用真实 route handler + 真实 20/60 秒配额验证；对「窗口过后
 * 配额确实恢复」这条，改用与生产代码相同的 MemoryRateLimiter 类、但注入一个短
 * refillIntervalMs 的独立实例来验证算法本身的恢复语义（tests/integration/
 * rate-limit.test.ts 已有类似模式），而不是等待生产配置的完整 60 秒——这不是「关闭
 * 限流」，是用同一份生产算法代码在可控的时间尺度下验证同一条恢复规则，测试文件顶部
 * 会明确注明这条用例不经过 HTTP 路由。
 *
 * 环境隔离（A10）：与 invitations.test.ts 同构——独立测试库 orbit_test、独立测试
 * 用户（RUN_TAG 唯一邮箱前缀）、afterAll 精确清理。限流桶用**伪造但格式合法**的 IP
 * 字符串区分测试用例，不依赖清理（内存态，进程退出即释放，不写入数据库）。
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);
const TEST_SECRET = "orbit-integration-invite-ratelimit-test-secret-0123456789";

process.env.APP_ENV = "test";
process.env.BETTER_AUTH_SECRET = TEST_SECRET;
// 本文件绝大多数用例需要按 IP 区分限流桶（隔离性、共享桶、伪造头无效等断言都要求
// resolveClientIp 真的按位置解析出不同的值），因此默认把 TRUSTED_PROXY_COUNT 设为 1
// ——用「client, 受信代理」两段式 X-Forwarded-For 模拟一层受信反向代理，取倒数第 1 项。
// 只有「TRUSTED_PROXY_COUNT=0 时伪造头完全无效」这一条用例需要退回默认的 0，
// 那条用例自己在开始前临时切换、结束后立即切回，不影响其它用例（见该 describe 块）。
process.env.TRUSTED_PROXY_COUNT = "1";
getEnv(true);

vi.mock("@/server/db/prisma", async () => {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { parseEnv: parseTestEnv } = await import("@/server/env");
  const testEnv = parseTestEnv(process.env as Record<string, string | undefined>);
  const adapter = new PrismaPg({
    connectionString: testEnv.TEST_DATABASE_URL,
    max: 10,
    options: "-c statement_timeout=5000 -c lock_timeout=3000",
  });
  return { prisma: new PrismaClient({ adapter }) };
});

const previewRoute = await import("@/app/api/v1/invitations/preview/route");
const acceptRoute = await import("@/app/api/v1/invitations/accept/route");
const { auth } = await import("@/server/auth");
const { prisma: testPrisma } = await import("@/server/db/prisma");

const RUN_TAG = `ratelimit-${Date.now()}`;
const domain = "orbit.test";
const PASSWORD = "IntegrationRateLimit!Pass0rd";
const BASE = `${env.BETTER_AUTH_URL}/api/v1`;
const TRUSTED_ORIGIN =
  env.AUTH_TRUSTED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0] ?? env.BETTER_AUTH_URL;

/**
 * 唯一伪造转发链生成器：每个测试用例拿到互不相同的「客户端自称, 受信代理观测值」
 * 两段式 X-Forwarded-For——TRUSTED_PROXY_COUNT=1 时 resolveClientIp 取倒数第 1 项，
 * 即这里的第二段（模拟受信代理自己观测到的直接来源），第一段可以是任意字符串
 * （模拟客户端自称，validate 层不校验其内容，只按位置取值）。
 */
let ipCounter = 0;
function nextFakeForwardedFor(): string {
  ipCounter += 1;
  // 10.0.0.0/8 私有段，格式合法，纯测试用途，不代表任何真实主机。
  const observedByProxy = `10.99.${Math.floor(ipCounter / 256)}.${ipCounter % 256}`;
  return `client-self-reported-${ipCounter}, ${observedByProxy}`;
}

async function createSessionCookie(email: string, name: string): Promise<string> {
  await auth.api.signUpEmail({ body: { email, password: PASSWORD, name } });
  await testPrisma.user.update({ where: { email }, data: { emailVerified: true } });
  const signIn = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    asResponse: true,
  });
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter((c) => c.length > 0)
    .join("; ");
  if (!cookie) throw new Error("sign-in did not return a session cookie");
  return cookie;
}

function jsonRequest(
  url: string,
  init: { method: string; body?: unknown; cookie?: string; forwardedFor?: string },
): Request {
  const headers = new Headers({
    origin: TRUSTED_ORIGIN,
    "content-type": "application/json",
  });
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.forwardedFor) headers.set("x-forwarded-for", init.forwardedFor);
  return new Request(url, {
    method: init.method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

const createdEmails: string[] = [];

beforeAll(async () => {
  const email = `${RUN_TAG}-owner@${domain}`;
  createdEmails.push(email);
  // 仅为建用户副作用（邮箱已记入 createdEmails，afterAll 统一清理）；cookie 值本文件
  // 不需要——需要登录身份的共享桶 / 写桶用例各自创建自己的会话（见下方 describe）。
  await createSessionCookie(email, "限流测试所有者");
}, 30_000);

afterAll(async () => {
  if (createdEmails.length > 0) {
    await testPrisma.user.deleteMany({ where: { email: { in: createdEmails } } });
  }
  // 清空本文件在共享 globalThis 限流单例上留下的桶状态（accept 用户写桶 +
  // 匿名邀请 IP 桶）——tests/integration 下所有文件在同一个 Node 进程内**顺序**
  // 执行（vitest.config.ts 的 fileParallelism:false），globalThis 单例因此在文件
  // 之间持续存在；若不清理，本文件耗尽的配额会原样带进下一个跑起来的测试文件
  // （已实测证实：invitations.test.ts 若在本文件之后运行，会因为 accept 端点残留的
  // 429 状态而失败）。不是给生产代码新增测试专用 reset 接口——直接访问
  // write-limit.ts 用来挂单例的那个 globalThis 属性名（模块内部实现细节，仅测试
  // 清理用途，不改变生产行为）。
  const anonymousState = globalThis as typeof globalThis & {
    __orbitAnonymousInviteRateLimiter__?: { clearAll: () => Promise<void> };
  };
  await anonymousState.__orbitAnonymousInviteRateLimiter__?.clearAll();

  const { RateLimiterFactory } = await import("@/server/modules/rate-limit");
  RateLimiterFactory.resetInstance();

  await testPrisma.$disconnect();
});

describe("邀请限流：preview 端点 20/IP/分钟", () => {
  it("同一伪造 IP 连续 20 次 preview 全部放行，第 21 次返回 429 RATE_LIMITED 且带 Retry-After", async () => {
    const ip = nextFakeForwardedFor();
    const fakeToken = randomUUID().replaceAll("-", "");

    for (let i = 0; i < 20; i += 1) {
      const res = await previewRoute.POST(
        jsonRequest(`${BASE}/invitations/preview`, {
          method: "POST",
          forwardedFor: ip,
          body: { token: fakeToken },
        }),
      );
      // token 不存在应该是 404，不是 429——前 20 次必须都拿到「业务层」的响应，
      // 证明限流本身还没触发（如果这里出现 429，说明配额被其它并发用例污染了）。
      expect(res.status, `第 ${i + 1} 次请求不应被限流`).not.toBe(429);
    }

    const limited = await previewRoute.POST(
      jsonRequest(`${BASE}/invitations/preview`, {
        method: "POST",
        forwardedFor: ip,
        body: { token: fakeToken },
      }),
    );
    expect(limited.status).toBe(429);
    const body = ErrorResponseSchema.parse(await limited.json());
    expect(body.error.code).toBe("RATE_LIMITED");
    const retryAfter = limited.headers.get("Retry-After");
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it("不同伪造 IP 之间的配额互相隔离：一个 IP 打满不影响另一个 IP", async () => {
    const ipA = nextFakeForwardedFor();
    const ipB = nextFakeForwardedFor();
    const fakeToken = randomUUID().replaceAll("-", "");

    for (let i = 0; i < 20; i += 1) {
      await previewRoute.POST(
        jsonRequest(`${BASE}/invitations/preview`, {
          method: "POST",
          forwardedFor: ipA,
          body: { token: fakeToken },
        }),
      );
    }
    const aLimited = await previewRoute.POST(
      jsonRequest(`${BASE}/invitations/preview`, {
        method: "POST",
        forwardedFor: ipA,
        body: { token: fakeToken },
      }),
    );
    expect(aLimited.status).toBe(429);

    // IP B 从未发过请求，应有完整配额（不受 A 打满影响）。
    const bStillOk = await previewRoute.POST(
      jsonRequest(`${BASE}/invitations/preview`, {
        method: "POST",
        forwardedFor: ipB,
        body: { token: fakeToken },
      }),
    );
    expect(bStillOk.status).not.toBe(429);
  });
});

describe("邀请限流：preview 与 accept 共享同一个 IP 桶（不是各自 20 次）", () => {
  it("同一 IP 交替调用 preview 与 accept，合计 20 次后第 21 次（无论调用哪个端点）都返回 429", async () => {
    const ip = nextFakeForwardedFor();
    const fakeToken = randomUUID().replaceAll("-", "");
    const email = `${RUN_TAG}-shared-bucket@${domain}`;
    createdEmails.push(email);
    const cookie = await createSessionCookie(email, "共享桶测试用户");

    // 交替调用两个端点各 10 次，合计 20 次——都不应该在这个阶段被限流。
    for (let i = 0; i < 10; i += 1) {
      const p = await previewRoute.POST(
        jsonRequest(`${BASE}/invitations/preview`, {
          method: "POST",
          forwardedFor: ip,
          body: { token: fakeToken },
        }),
      );
      expect(p.status, `preview 第 ${i + 1} 次不应被限流`).not.toBe(429);

      const a = await acceptRoute.POST(
        jsonRequest(`${BASE}/invitations/accept`, {
          method: "POST",
          cookie,
          forwardedFor: ip,
          body: { token: fakeToken },
        }),
      );
      // accept 会话有效，token 无效（404/410），但**不应该**是 429——这里验证的是
      // IP 桶还没耗尽，不是业务结果。
      expect(a.status, `accept 第 ${i + 1} 次不应被限流`).not.toBe(429);
    }

    // 合计正好 20 次后，第 21 次无论打哪个端点都应该被同一个桶拒绝——
    // 核心断言：证明这是**同一个**桶，不是 preview 和 accept 各自独立的 20 次。
    const previewOverflow = await previewRoute.POST(
      jsonRequest(`${BASE}/invitations/preview`, {
        method: "POST",
        forwardedFor: ip,
        body: { token: fakeToken },
      }),
    );
    expect(previewOverflow.status).toBe(429);
  });
});

describe("邀请限流：accept 同时受用户写桶约束（IP 桶未满，也会因为用户写桶耗尽被拒）", () => {
  it("同一用户对 accept 发起足以耗尽写桶配额的请求后，即使换一个全新的 IP 仍返回 429", async () => {
    const email = `${RUN_TAG}-write-bucket@${domain}`;
    createdEmails.push(email);
    const cookie = await createSessionCookie(email, "写桶测试用户");
    const fakeToken = randomUUID().replaceAll("-", "");

    // 写桶配额 60/分钟（docs/03 §8）；每次请求换一个全新 IP，确保只可能是写桶
    // 耗尽导致 429，不是 IP 桶（IP 桶从未在同一个 IP 上累积超过 1 次）。
    let lastStatus = 0;
    for (let i = 0; i < 60; i += 1) {
      const res = await acceptRoute.POST(
        jsonRequest(`${BASE}/invitations/accept`, {
          method: "POST",
          cookie,
          forwardedFor: nextFakeForwardedFor(),
          body: { token: fakeToken },
        }),
      );
      lastStatus = res.status;
    }
    expect(lastStatus, "前 60 次（每次全新 IP）不应被 IP 桶限流").not.toBe(429);

    const overflow = await acceptRoute.POST(
      jsonRequest(`${BASE}/invitations/accept`, {
        method: "POST",
        cookie,
        forwardedFor: nextFakeForwardedFor(), // 依然是全新 IP，排除 IP 桶干扰。
        body: { token: fakeToken },
      }),
    );
    expect(overflow.status).toBe(429);
    const body = ErrorResponseSchema.parse(await overflow.json());
    expect(body.error.code).toBe("RATE_LIMITED");
  }, 30_000);
});

describe("邀请限流：TRUSTED_PROXY_COUNT=0（未配置受信代理）时伪造 X-Forwarded-For 对判定无效", () => {
  // 这条用例专门验证「没有配置受信代理」这个具体场景，需要临时把
  // TRUSTED_PROXY_COUNT 切回 0（本文件其余用例统一用 1，见文件头注释）；
  // 结束后立即切回 1，避免影响后续用例（尤其是窗口恢复用例之前的任何清理假设）。
  beforeAll(() => {
    process.env.TRUSTED_PROXY_COUNT = "0";
    getEnv(true);
  });
  afterAll(() => {
    process.env.TRUSTED_PROXY_COUNT = "1";
    getEnv(true);
  });

  it("大量互不相同的伪造 X-Forwarded-For 值全部落进同一个固定占位桶，合计仍受 20/分钟约束", async () => {
    // 显式确认这条用例执行期间确实是 TRUSTED_PROXY_COUNT=0——上面的 beforeAll 已经
    // 设置，这里再断言一次，防止未来重排 describe 顺序时静默失效。
    expect(getEnv().TRUSTED_PROXY_COUNT).toBe(0);

    const fakeToken = randomUUID().replaceAll("-", "");
    let blockedAt = -1;
    for (let i = 0; i < 25; i += 1) {
      // 每次请求都用一个全新、互不相同的伪造转发链——如果伪造头真的被采信，这应该
      // 表现为「永远不会被限流」（每个「IP」都有自己独立的满配额）；但因为
      // TRUSTED_PROXY_COUNT=0 时 resolveClientIp 完全忽略这个头，这些请求实际上
      // 全部落进同一个固定占位桶，必须在第 21 次左右被限流。
      const res = await previewRoute.POST(
        jsonRequest(`${BASE}/invitations/preview`, {
          method: "POST",
          forwardedFor: `203.0.113.${i}, 198.51.100.${i}`, // 每次都不同，但应该被忽略。
          body: { token: fakeToken },
        }),
      );
      if (res.status === 429) {
        blockedAt = i;
        break;
      }
    }
    // 必须确实发生了限流（不是「跑满 25 次都没事」）——证明伪造头没有生效。
    expect(blockedAt, "伪造互不相同的 X-Forwarded-For 应该仍然合计触发限流，而不是被采信为 25 个独立来源").toBeGreaterThanOrEqual(0);
    expect(blockedAt).toBeLessThan(25);
  });
});

describe("客户端 IP 边界验证（R3 安全修复）", () => {
  // 这些用例需要 TRUSTED_PROXY_COUNT=1 以便能按 IP 区分桶
  beforeAll(() => {
    process.env.TRUSTED_PROXY_COUNT = "1";
    getEnv(true);
  });

  it("拒绝任意字符串作为 bucket keys（如 \"arbitrary-bucket-001\"）", async () => {
    const fakeToken = randomUUID().replaceAll("-", "");
    const response = await previewRoute.POST(
      jsonRequest(`${BASE}/invitations/preview`, {
        method: "POST",
        forwardedFor: "arbitrary-bucket-001",
        body: { token: fakeToken },
      }),
    );
    // 无效的 IP 格式应退化为保守桶，导致限流
    expect(response.status).toBe(429); // Invalid IP format → conservative bucket
  });
});

/**
 * 窗口恢复语义（不经过 HTTP 路由，见文件头注释「§窗口恢复」）：验证 MemoryRateLimiter
 * 类本身「过窗口后完整恢复（不是增量累积）」的算法行为——preview/accept 路由用的正是
 * 这个类（globalThis 单例），这里独立实例化一份、注入极短的 refillIntervalMs，
 * 直接调用同一份生产代码的 checkLimit，不是另写一套模拟逻辑。
 */
describe("邀请限流：窗口恢复（同一份生产 MemoryRateLimiter 算法，短窗口验证）", () => {
  it("耗尽配额后等待一个完整窗口，配额应恢复到满值而不是增量恢复", async () => {
    const { MemoryRateLimiter } = await import("@/server/modules/rate-limit/memory");
    const shortWindowLimiter = new MemoryRateLimiter({ maxTokens: 20, refillIntervalMs: 300 });
    shortWindowLimiter.stopCleanupInterval();
    const bucketKey = `window-recovery-${randomUUID()}`;

    for (let i = 0; i < 20; i += 1) {
      const r = await shortWindowLimiter.checkLimit(bucketKey, "anonymous-invite");
      expect(r.allowed).toBe(true);
    }
    const exhausted = await shortWindowLimiter.checkLimit(bucketKey, "anonymous-invite");
    expect(exhausted.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 350)); // 略大于 refillIntervalMs。

    const recovered = await shortWindowLimiter.checkLimit(bucketKey, "anonymous-invite");
    expect(recovered.allowed).toBe(true);
    // 恢复后应该是「满配额」（maxTokens - 1，因为这次调用本身消耗了一个 token），
    // 不是「只多恢复了一点」——直接验证 full-recovery 语义，不是增量。
    expect(recovered.remaining).toBe(19);
  });
});
