import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { getEnv, parseEnv } from "@/server/env";

/**
 * 并发创建项目配额测试（M2 / ORB-007，docs/04 §4/§6、docs/01 §4）。
 *
 * 目标：验证「未归档项目数 ≤ MAX_ACTIVE_PROJECTS(10)」这一配额不变量在**并发**下依然成立。
 * createProject 在事务内先 `lockUserRow(FOR UPDATE)`，把同一用户的创建串行化，
 * 因此 12 个并发请求（各带不同 Idempotency-Key、不同项目 key）中：
 *   恰好 10 个成功（201），后 2 个在锁内计数到 active=10 → 422 LIMIT_EXCEEDED。
 * 若缺少用户级行锁，计数-插入的竞态会导致超过 10 个项目落库。
 *
 * 基础设施与 project.test.ts / me.test.ts 一致（vi.mock 绑定 TEST_DATABASE_URL + APP_ENV=test）。
 * 连接池 max=15：确保 12 个并发事务都能拿到连接，把竞争聚焦到**行锁**而非连接池。
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);

const TEST_SECRET = "orbit-integration-test-secret-0123456789";

process.env.APP_ENV = "test";
process.env.BETTER_AUTH_SECRET = TEST_SECRET;
getEnv(true);

vi.mock("@/server/db/prisma", async () => {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { parseEnv: parseTestEnv } = await import("@/server/env");
  const testEnv = parseTestEnv(process.env as Record<string, string | undefined>);
  const adapter = new PrismaPg({
    connectionString: testEnv.TEST_DATABASE_URL,
    max: 15,
    options: "-c statement_timeout=5000 -c lock_timeout=3000",
  });
  return { prisma: new PrismaClient({ adapter }) };
});

const projectsRoute = await import("@/app/api/v1/projects/route");
const { auth } = await import("@/server/auth");
const { prisma: testPrisma } = await import("@/server/db/prisma");

const RUN_TAG = `orb007c-${Date.now()}`;
const domain = "orbit.test";
const EMAIL = `${RUN_TAG}-conc@${domain}`;
const PASSWORD = "Str0ng!Passw0rd-OrbitTest";
const NAME = "并发用户";

const BASE = `${env.BETTER_AUTH_URL}/api/v1`;
const TRUSTED_ORIGIN =
  env.AUTH_TRUSTED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0] ?? env.BETTER_AUTH_URL;

const KEY_PREFIX = `C${Date.now().toString(36).slice(-4).toUpperCase()}`;

let cookie = "";
let userId = "";

async function signUpVerified(email: string, name: string): Promise<void> {
  await auth.api.signUpEmail({ body: { email, password: PASSWORD, name } });
  await testPrisma.user.update({ where: { email }, data: { emailVerified: true } });
}

async function signIn(email: string): Promise<string> {
  const res = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    asResponse: true,
  });
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter((c) => c.length > 0)
    .join("; ");
}

async function cleanup(): Promise<void> {
  const users = await testPrisma.user.findMany({
    where: { email: { contains: RUN_TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  const projects = await testPrisma.project.findMany({
    where: { ownerId: { in: userIds } },
    select: { id: true },
  });
  const projectIds = projects.map((p) => p.id);
  await testPrisma.activityLog.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.idempotencyRecord.deleteMany({ where: { userId: { in: userIds } } });
  await testPrisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await testPrisma.user.deleteMany({ where: { id: { in: userIds } } });
  await testPrisma.verification.deleteMany({ where: { identifier: { contains: RUN_TAG } } });
}

beforeAll(async () => {
  await cleanup();
  await signUpVerified(EMAIL, NAME);
  cookie = await signIn(EMAIL);
  expect(cookie).toContain("session_token");
  const row = await testPrisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
  userId = row.id;
}, 120_000);

afterAll(async () => {
  await cleanup();
  await testPrisma.$disconnect();
});

describe("并发创建项目：配额不变量在竞态下成立", () => {
  it("Promise.all 并发 12 次（不同 Idempotency-Key）→ 恰好 10 个 201、2 个 422 LIMIT_EXCEEDED", async () => {
    const TOTAL = 12;
    const requests = Array.from({ length: TOTAL }, (_, i) => {
      const headers = new Headers();
      headers.set("cookie", cookie);
      headers.set("origin", TRUSTED_ORIGIN);
      headers.set("content-type", "application/json");
      headers.set("idempotency-key", randomUUID()); // 各请求不同幂等键
      const body = JSON.stringify({
        name: `并发项目 ${i}`,
        key: `${KEY_PREFIX}${String(i).padStart(2, "0")}`.slice(0, 8), // 各请求不同项目 key
      });
      return projectsRoute.POST(new Request(`${BASE}/projects`, { method: "POST", headers, body }));
    });

    const responses = await Promise.all(requests);
    const statuses = await Promise.all(responses.map((r) => r.status));

    const created = statuses.filter((s) => s === 201).length;
    const limited = statuses.filter((s) => s === 422).length;

    expect(created).toBe(10);
    expect(limited).toBe(2);
    // 不允许出现其它状态（如 500/409），否则说明竞态处理有缺陷。
    expect(created + limited).toBe(TOTAL);

    // 落库佐证：该用户恰好 10 个未归档项目，绝无超额。
    const activeCount = await testPrisma.project.count({
      where: { ownerId: userId, archivedAt: null },
    });
    expect(activeCount).toBe(10);

    // 422 响应的错误码必须是 LIMIT_EXCEEDED。
    for (let i = 0; i < responses.length; i += 1) {
      if (statuses[i] === 422) {
        const json = (await responses[i]!.json()) as { error?: { code?: string } };
        expect(json.error?.code).toBe("LIMIT_EXCEEDED");
      }
    }
  }, 60_000);
});
