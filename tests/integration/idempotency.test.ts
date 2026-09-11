import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { ProjectSchema, SuccessResponseSchema, type ProjectDTO } from "@/contracts";
import { getEnv, parseEnv } from "@/server/env";

/**
 * 幂等语义集成测试（M2 / ORB-007，docs/05 §5、docs/04 §3）。
 *
 * 聚焦 `Idempotency-Key` 的三条核心语义（以 POST /projects 为载体）：
 *  1. 同 key 同 body → 重放原响应（200，同一资源 id，不重复副作用）；
 *  2. 同 key 异 body → 409 IDEMPOTENCY_CONFLICT（键被复用于不同请求）；
 *  3. **过期记录不去重**：expiresAt 过期后，同 key 即便 body 不同也按全新请求执行
 *     （beginIdempotency 删除过期记录 → 不再做 hash 比对 → 重新执行 → 201 新资源）。
 *
 * 基础设施与 me.test.ts / project.test.ts 一致（vi.mock 绑定 TEST_DATABASE_URL + APP_ENV=test）。
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

const RUN_TAG = `orb007i-${Date.now()}`;
const domain = "orbit.test";
const EMAIL = `${RUN_TAG}-idem@${domain}`;
const PASSWORD = "Str0ng!Passw0rd-OrbitTest";
const NAME = "幂等用户";

const BASE = `${env.BETTER_AUTH_URL}/api/v1`;
const TRUSTED_ORIGIN =
  env.AUTH_TRUSTED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0] ?? env.BETTER_AUTH_URL;

/** 创建项目的幂等 routeKey（须与 create.ts 的 CREATE_PROJECT_ROUTE_KEY 一致）。 */
const CREATE_ROUTE_KEY = "POST /projects";

const KEY_PREFIX = `I${Date.now().toString(36).slice(-4).toUpperCase()}`;
let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `${KEY_PREFIX}${String(keyCounter).padStart(2, "0")}`.slice(0, 8);
}

const ProjectSuccess = SuccessResponseSchema(ProjectSchema);

let cookie = "";
let userId = "";

function postProject(body: unknown, idempotencyKey: string): Promise<Response> {
  const headers = new Headers();
  headers.set("cookie", cookie);
  headers.set("origin", TRUSTED_ORIGIN);
  headers.set("content-type", "application/json");
  headers.set("idempotency-key", idempotencyKey);
  return projectsRoute.POST(
    new Request(`${BASE}/projects`, { method: "POST", headers, body: JSON.stringify(body) }),
  );
}

async function readProject(response: Response): Promise<ProjectDTO> {
  return ProjectSuccess.parse((await response.json()) as unknown).data;
}

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

async function resetProjects(): Promise<void> {
  if (userId.length === 0) return;
  const projects = await testPrisma.project.findMany({
    where: { ownerId: userId },
    select: { id: true },
  });
  const projectIds = projects.map((p) => p.id);
  await testPrisma.activityLog.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.idempotencyRecord.deleteMany({ where: { userId } });
  await testPrisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.project.deleteMany({ where: { id: { in: projectIds } } });
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

afterEach(async () => {
  await resetProjects();
});

afterAll(async () => {
  await cleanup();
  await testPrisma.$disconnect();
});

describe("幂等语义（POST /projects）", () => {
  it("同 key 同 body → 200 重放原结果（同一 id，仅创建一条）", async () => {
    const idempotencyKey = randomUUID();
    const key = nextKey();
    const body = { name: "幂等重放", key };

    const first = await postProject(body, idempotencyKey);
    expect(first.status).toBe(201);
    const firstProject = await readProject(first);

    const second = await postProject(body, idempotencyKey);
    expect(second.status).toBe(200);
    const secondProject = await readProject(second);
    expect(secondProject.id).toBe(firstProject.id);

    expect(await testPrisma.project.count({ where: { key } })).toBe(1);
  });

  it("同 key 异 body → 409 IDEMPOTENCY_CONFLICT", async () => {
    const idempotencyKey = randomUUID();
    const first = await postProject({ name: "甲", key: nextKey() }, idempotencyKey);
    expect(first.status).toBe(201);

    const second = await postProject({ name: "乙", key: nextKey() }, idempotencyKey);
    expect(second.status).toBe(409);
    const json = (await second.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("过期记录不去重：expiresAt 过期后同 key 异 body 按全新请求执行 → 201 新资源", async () => {
    const idempotencyKey = randomUUID();
    const first = await postProject({ name: "过期前", key: nextKey() }, idempotencyKey);
    expect(first.status).toBe(201);
    const firstProject = await readProject(first);

    // 手动把该幂等记录置为已过期（模拟 24h TTL 到期）。
    await testPrisma.idempotencyRecord.update({
      where: {
        userId_method_routeKey_key: {
          userId,
          method: "POST",
          routeKey: CREATE_ROUTE_KEY,
          key: idempotencyKey,
        },
      },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    // 过期后：同 key 但不同 body —— 若未过期本应 409 冲突；过期则删除旧记录按新请求执行。
    const secondKey = nextKey();
    const second = await postProject({ name: "过期后", key: secondKey }, idempotencyKey);
    expect(second.status).toBe(201);
    const secondProject = await readProject(second);
    expect(secondProject.id).not.toBe(firstProject.id);
    expect(secondProject.key).toBe(secondKey);
  });
});
