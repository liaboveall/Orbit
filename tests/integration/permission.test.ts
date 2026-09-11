import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import {
  ErrorResponseSchema,
  ProjectSchema,
  SuccessResponseSchema,
  TaskSchema,
  type ErrorResponse,
  type ProjectDTO,
  type TaskDTO,
} from "@/contracts";
import { getEnv, parseEnv } from "@/server/env";
import { REQUEST_ID_HEADER } from "@/server/http/request-id";

/**
 * 越权与幂等重放重新授权集成测试（M2 CodeReview 补充 / docs/07 T-PERM-01）。
 *
 * docs/07 T-PERM-01 要求覆盖三类主体：非成员、**已移除用户**、（对照）成员。
 * 既有 project.test.ts / task.test.ts 已覆盖「非成员」，本文件补齐缺失的**已移除用户**：
 * 用户 B 曾是项目成员，被 `projectMember.deleteMany` 移除后，其对项目及其资源的一切访问
 * 必须统一收敛为 **404 NOT_FOUND**（而非 403），以不泄露「项目/任务是否存在」这一信息
 * （docs/03 §5、docs/05 §3：非成员与不存在同形）。
 *
 * 另验证**幂等重放重新授权**（docs/04 §3、docs/05 §4）：B 在被移除**前**用某 Idempotency-Key
 * 成功创建任务，被移除**后**用同 key 同 body 重放 → 必须 404（而非回放旧缓存响应），
 * 证明 createTask 在重放前重新校验了成员关系（锁前 requireProjectMember 预检 + 锁内复核）。
 *
 * ⚠️ 单例隔离（必须在动态 import 前）：vi.mock 绑定 TEST_DATABASE_URL + APP_ENV=test 关闭限流。
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);

/** 仅供测试的固定密钥（≥32），非任何真实凭证。 */
const TEST_SECRET = "orbit-integration-test-secret-0123456789";

/* ── 环境覆写：关闭限流 + 固定测试密钥（必须在动态 import 前）────────────── */
process.env.APP_ENV = "test";
process.env.BETTER_AUTH_SECRET = TEST_SECRET;
getEnv(true);

/**
 * 把应用 Prisma 单例替换为绑定 orbit_test 的客户端（惰性工厂，首次 import 时执行）。
 * 连接池 max=15：给并发/多事务留出余量。
 */
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

/* ── 动态 import（必须在环境覆写与 vi.mock 注册之后）────────────────────── */
const projectsRoute = await import("@/app/api/v1/projects/route");
const projectRoute = await import("@/app/api/v1/projects/[projectId]/route");
const membersRoute = await import("@/app/api/v1/projects/[projectId]/members/route");
const tasksRoute = await import("@/app/api/v1/projects/[projectId]/tasks/route");
const taskRoute = await import("@/app/api/v1/tasks/[taskId]/route");
const restoreRoute = await import("@/app/api/v1/tasks/[taskId]/restore/route");
const { auth } = await import("@/server/auth");
const { prisma: testPrisma } = await import("@/server/db/prisma");

/* ── 夹具常量 ─────────────────────────────────────────────────────────── */

const RUN_TAG = `orbperm-${Date.now()}`;
const domain = "orbit.test";
const EMAIL_A = `${RUN_TAG}-a@${domain}`; // 项目 owner
const EMAIL_B = `${RUN_TAG}-b@${domain}`; // 曾被加入、随后被移除的用户
const PASSWORD = "Str0ng!Passw0rd-OrbitTest";
const NAME_A = "项目主";
const NAME_B = "被移除乙";

const BASE = `${env.BETTER_AUTH_URL}/api/v1`;
const TRUSTED_ORIGIN =
  env.AUTH_TRUSTED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0] ?? env.BETTER_AUTH_URL;

/** key 前缀：run 唯一，确保跨运行不撞 DB 全局唯一约束。 */
const KEY_PREFIX = `P${Date.now().toString(36).slice(-4).toUpperCase()}`;
let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `${KEY_PREFIX}${String(keyCounter).padStart(2, "0")}`.slice(0, 8);
}

/* ── 信封校验器（strict）───────────────────────────────────────────────── */
const ProjectSuccess = SuccessResponseSchema(ProjectSchema);
const TaskSuccess = SuccessResponseSchema(TaskSchema);

/* ── 请求辅助 ─────────────────────────────────────────────────────────── */

interface ReqOptions {
  cookie?: string | null;
  body?: unknown;
  origin?: string | null;
  idempotencyKey?: string;
  requestId?: string;
}

function buildRequest(method: string, url: string, options: ReqOptions = {}): Request {
  const { cookie = null, body, origin = TRUSTED_ORIGIN, idempotencyKey, requestId } = options;
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (origin !== null) headers.set("origin", origin);
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  if (requestId) headers.set(REQUEST_ID_HEADER, requestId);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

function ctxProject(projectId: string): { params: Promise<{ projectId: string }> } {
  return { params: Promise.resolve({ projectId }) };
}
function ctxTask(taskId: string): { params: Promise<{ taskId: string }> } {
  return { params: Promise.resolve({ taskId }) };
}

async function readError(response: Response): Promise<ErrorResponse> {
  return ErrorResponseSchema.parse((await response.json()) as unknown);
}

/** 断言响应为 404 NOT_FOUND（不泄露存在性，绝不 403）。 */
async function expectNotFound(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  expect((await readError(response)).error.code).toBe("NOT_FOUND");
}

/* ── 认证夹具 ─────────────────────────────────────────────────────────── */

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

let cookieA = "";
let cookieB = "";
let userAId = "";
let userBId = "";

/** 清理本 run 数据（FK onDelete: Restrict，须按 子→父 顺序删除；Task 先于 Project）。 */
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
  await testPrisma.task.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.projectMember.deleteMany({
    where: { OR: [{ projectId: { in: projectIds } }, { userId: { in: userIds } }] },
  });
  await testPrisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await testPrisma.user.deleteMany({ where: { id: { in: userIds } } });
  await testPrisma.verification.deleteMany({ where: { identifier: { contains: RUN_TAG } } });
}

beforeAll(async () => {
  await cleanup();
  await signUpVerified(EMAIL_A, NAME_A);
  await signUpVerified(EMAIL_B, NAME_B);
  cookieA = await signIn(EMAIL_A);
  cookieB = await signIn(EMAIL_B);
  expect(cookieA).toContain("session_token");
  expect(cookieB).toContain("session_token");
  const a = await testPrisma.user.findUniqueOrThrow({ where: { email: EMAIL_A } });
  const b = await testPrisma.user.findUniqueOrThrow({ where: { email: EMAIL_B } });
  userAId = a.id;
  userBId = b.id;
}, 120_000);

afterEach(async () => {
  const userIds = [userAId, userBId].filter((id) => id.length > 0);
  if (userIds.length === 0) return;
  const projects = await testPrisma.project.findMany({
    where: { ownerId: { in: userIds } },
    select: { id: true },
  });
  const projectIds = projects.map((p) => p.id);
  await testPrisma.activityLog.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.idempotencyRecord.deleteMany({ where: { userId: { in: userIds } } });
  await testPrisma.task.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.projectMember.deleteMany({
    where: { OR: [{ projectId: { in: projectIds } }, { userId: { in: userIds } }] },
  });
  await testPrisma.project.deleteMany({ where: { id: { in: projectIds } } });
});

afterAll(async () => {
  await cleanup();
  await testPrisma.$disconnect();
});

/* ── 领域辅助 ─────────────────────────────────────────────────────────── */

/** A 创建项目并断言 201。 */
async function createProjectOk(name: string): Promise<ProjectDTO> {
  const response = await projectsRoute.POST(
    buildRequest("POST", `${BASE}/projects`, {
      cookie: cookieA,
      body: { name, key: nextKey() },
      idempotencyKey: randomUUID(),
    }),
  );
  expect(response.status).toBe(201);
  return ProjectSuccess.parse((await response.json()) as unknown).data;
}

/** A 在项目内创建任务并断言 201。 */
async function createTaskOkA(projectId: string, title: string): Promise<TaskDTO> {
  const response = await tasksRoute.POST(
    buildRequest("POST", `${BASE}/projects/${projectId}/tasks`, {
      cookie: cookieA,
      body: { title },
      idempotencyKey: randomUUID(),
    }),
    ctxProject(projectId),
  );
  expect(response.status).toBe(201);
  return TaskSuccess.parse((await response.json()) as unknown).data;
}

/** 把 B 加为项目成员，随后再移除（模拟「已移除用户」）。 */
async function addThenRemoveMember(projectId: string): Promise<void> {
  await testPrisma.projectMember.create({ data: { projectId, userId: userBId } });
  // 确认加入成功后再移除。
  const added = await testPrisma.projectMember.count({
    where: { projectId, userId: userBId },
  });
  expect(added).toBe(1);
  await testPrisma.projectMember.deleteMany({ where: { projectId, userId: userBId } });
  const removed = await testPrisma.projectMember.count({
    where: { projectId, userId: userBId },
  });
  expect(removed).toBe(0);
}

/* ── 1. 已移除用户越权 → 一律 404 NOT_FOUND（T-PERM-01）────────────────── */

describe("已移除用户越权：项目级端点一律 404 NOT_FOUND（不泄露存在性）", () => {
  it("B 被移除后 GET/PATCH 项目、列出成员、列出/创建任务 → 全部 404", async () => {
    const project = await createProjectOk("已移除用户项目");
    const task = await createTaskOkA(project.id, "项目内任务");
    await addThenRemoveMember(project.id);

    // GET /projects/{id}
    await expectNotFound(
      await projectRoute.GET(
        buildRequest("GET", `${BASE}/projects/${project.id}`, { cookie: cookieB }),
        ctxProject(project.id),
      ),
    );

    // PATCH /projects/{id}（owner-only，但非成员应先 404，不暴露 403）
    await expectNotFound(
      await projectRoute.PATCH(
        buildRequest("PATCH", `${BASE}/projects/${project.id}`, {
          cookie: cookieB,
          body: { expectedVersion: project.version, name: "越权改名" },
        }),
        ctxProject(project.id),
      ),
    );

    // GET /projects/{id}/members
    await expectNotFound(
      await membersRoute.GET(
        buildRequest("GET", `${BASE}/projects/${project.id}/members`, { cookie: cookieB }),
        ctxProject(project.id),
      ),
    );

    // GET /projects/{id}/tasks
    await expectNotFound(
      await tasksRoute.GET(
        buildRequest("GET", `${BASE}/projects/${project.id}/tasks`, { cookie: cookieB }),
        ctxProject(project.id),
      ),
    );

    // POST /projects/{id}/tasks
    await expectNotFound(
      await tasksRoute.POST(
        buildRequest("POST", `${BASE}/projects/${project.id}/tasks`, {
          cookie: cookieB,
          body: { title: "越权创建" },
          idempotencyKey: randomUUID(),
        }),
        ctxProject(project.id),
      ),
    );

    // 佐证：任务确实仍存在（B 只是不可见，而非资源被删）。
    expect(await testPrisma.task.count({ where: { id: task.id } })).toBe(1);
  });

  it("B 被移除后 GET/PATCH/DELETE 任务、restore 任务 → 全部 404", async () => {
    const project = await createProjectOk("已移除用户任务项目");
    const task = await createTaskOkA(project.id, "被移除者曾可见的任务");
    await addThenRemoveMember(project.id);

    // GET /tasks/{taskId}
    await expectNotFound(
      await taskRoute.GET(
        buildRequest("GET", `${BASE}/tasks/${task.id}`, { cookie: cookieB }),
        ctxTask(task.id),
      ),
    );

    // PATCH /tasks/{taskId}
    await expectNotFound(
      await taskRoute.PATCH(
        buildRequest("PATCH", `${BASE}/tasks/${task.id}`, {
          cookie: cookieB,
          body: { expectedVersion: task.version, title: "越权改任务" },
        }),
        ctxTask(task.id),
      ),
    );

    // DELETE /tasks/{taskId}
    await expectNotFound(
      await taskRoute.DELETE(
        buildRequest("DELETE", `${BASE}/tasks/${task.id}?expectedVersion=${task.version}`, {
          cookie: cookieB,
        }),
        ctxTask(task.id),
      ),
    );

    // POST /tasks/{taskId}/restore
    await expectNotFound(
      await restoreRoute.POST(
        buildRequest("POST", `${BASE}/tasks/${task.id}/restore`, {
          cookie: cookieB,
          body: { expectedVersion: task.version },
          idempotencyKey: randomUUID(),
        }),
        ctxTask(task.id),
      ),
    );

    // 佐证：任务未被越权改动（version 未变、未软删除）。
    const row = await testPrisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.version).toBe(task.version);
    expect(row.deletedAt).toBeNull();
  });
});

/* ── 2. 幂等重放重新授权（docs/04 §3、docs/05 §4）────────────────────── */

describe("幂等重放重新授权：被移除用户重放旧 Idempotency-Key → 404（不回放缓存）", () => {
  it("B 移除前用 key K 成功建任务，移除后同 key 同 body 重放 → 404，且不新增任务", async () => {
    const project = await createProjectOk("重放授权项目");
    // B 加入项目。
    await testPrisma.projectMember.create({ data: { projectId: project.id, userId: userBId } });

    const idempotencyKey = randomUUID();
    const body = { title: "B 移除前创建的任务" };

    // 移除前：B 用 key K 成功创建任务（成员身份 → 201）。
    const firstRes = await tasksRoute.POST(
      buildRequest("POST", `${BASE}/projects/${project.id}/tasks`, {
        cookie: cookieB,
        body,
        idempotencyKey,
      }),
      ctxProject(project.id),
    );
    expect(firstRes.status).toBe(201);
    const firstTask = TaskSuccess.parse((await firstRes.json()) as unknown).data;
    expect(firstTask.creator.id).toBe(userBId);

    const taskCountAfterCreate = await testPrisma.task.count({
      where: { projectId: project.id },
    });
    expect(taskCountAfterCreate).toBe(1);

    // 移除 B。
    await testPrisma.projectMember.deleteMany({
      where: { projectId: project.id, userId: userBId },
    });

    // 移除后：B 用同 key 同 body 重放 → 必须 404（重放前重新授权），而非回放旧 201 响应。
    const replayRes = await tasksRoute.POST(
      buildRequest("POST", `${BASE}/projects/${project.id}/tasks`, {
        cookie: cookieB,
        body,
        idempotencyKey,
      }),
      ctxProject(project.id),
    );
    await expectNotFound(replayRes);

    // 重放未产生任何副作用：任务数不变，仍只有 B 移除前创建的那一条。
    expect(await testPrisma.task.count({ where: { projectId: project.id } })).toBe(
      taskCountAfterCreate,
    );
  });
});
