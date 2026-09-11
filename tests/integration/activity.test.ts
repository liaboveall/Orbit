import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import {
  DeletedTaskSchema,
  ProjectSchema,
  SuccessResponseSchema,
  TaskSchema,
  type ActivityAction,
  type ProjectDTO,
  type TaskDTO,
} from "@/contracts";
import { getEnv, parseEnv } from "@/server/env";

/**
 * M2 Phase 7 / ORB-009：纵向闭环集成验证 — 活动事务一致性（activity）。
 *
 * 与 task.test.ts / project.test.ts 同一套基础设施：在**独立测试库 orbit_test**
 * （TEST_DATABASE_URL）上直接调用 Next.js route handler（纯 `(Request, ctx?) => Response`），
 * 覆盖真实路由编排（请求 ID → Origin → 会话 → Idempotency-Key → schema → 领域服务 → 信封）。
 *
 * 验证「活动日志与业务写入同一事务」（docs/01 §8、docs/04 §3、T-ACTIVITY-01）：
 *  - 创建项目成功 → 该项目恰好 1 条 PROJECT_CREATED（metadata 为空对象）；
 *  - 创建任务成功 → 恰好 1 条 TASK_CREATED（metadata.taskIdentifier = `${key}-${number}`）；
 *  - 有变化 PATCH → 恰好 1 条 TASK_UPDATED + version++；
 *  - 无语义变化 PATCH → 不写活动、不 bump version；
 *  - 业务失败（expectedVersion 不符 → 409）→ 事务回滚，无任何残留活动；
 *  - 软删除 → TASK_DELETED；恢复 → TASK_RESTORED；归档项目 → PROJECT_ARCHIVED。
 *
 * ⚠️ 单例隔离（必须在动态 import 前）：
 *  - `vi.mock("@/server/db/prisma")` 把应用 Prisma 单例换成绑定 TEST_DATABASE_URL 的客户端；
 *  - `APP_ENV="test"` 关闭 Better Auth 内置限流；
 *  - 会话夹具用**同一个** auth 单例签发 cookie。
 *
 * 说明：orbit_test 是干净库（不含业务种子），故本文件自建用户 + 自建项目/任务，
 * 每个用例在独立项目上断言活动计数，afterEach 回收本 run 数据以保持库纯净。
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);

/** 仅供测试的固定密钥（≥32），非任何真实凭证。 */
const TEST_SECRET = "orbit-integration-activity-test-secret-0123456789";

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
const tasksRoute = await import("@/app/api/v1/projects/[projectId]/tasks/route");
const taskRoute = await import("@/app/api/v1/tasks/[taskId]/route");
const restoreRoute = await import("@/app/api/v1/tasks/[taskId]/restore/route");
const { auth } = await import("@/server/auth");
const { prisma: testPrisma } = await import("@/server/db/prisma");

/* ── 夹具常量 ─────────────────────────────────────────────────────────── */

const RUN_TAG = `act-${Date.now()}`;
const domain = "orbit.test";
const EMAIL = `${RUN_TAG}@${domain}`;
const PASSWORD = "IntegrationActivity!Pass0rd";
const NAME = "活动测试用户";

const BASE = `${env.BETTER_AUTH_URL}/api/v1`;
const TRUSTED_ORIGIN =
  env.AUTH_TRUSTED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0] ?? env.BETTER_AUTH_URL;

/** key 前缀：run 唯一，确保跨运行不撞 DB 全局唯一约束。 */
const KEY_PREFIX = `A${Date.now().toString(36).slice(-4).toUpperCase()}`;
let keyCounter = 0;
/** 生成合法且本次运行内唯一的项目 key（`/^[A-Z][A-Z0-9]{1,7}$/`，≤8 位）。 */
function nextKey(): string {
  keyCounter += 1;
  return `${KEY_PREFIX}${String(keyCounter).padStart(2, "0")}`.slice(0, 8);
}

/* ── 信封校验器（strict，形状不合契约直接抛错）────────────────────────── */
const ProjectSuccess = SuccessResponseSchema(ProjectSchema);
const TaskSuccess = SuccessResponseSchema(TaskSchema);
const DeletedTaskSuccess = SuccessResponseSchema(DeletedTaskSchema);

/* ── 请求辅助 ─────────────────────────────────────────────────────────── */

interface ReqOptions {
  cookie?: string | null;
  body?: unknown;
  origin?: string | null;
  idempotencyKey?: string;
}

function buildRequest(method: string, url: string, options: ReqOptions = {}): Request {
  const { cookie = null, body, origin = TRUSTED_ORIGIN, idempotencyKey } = options;
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (origin !== null) headers.set("origin", origin);
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

/** 项目动态段上下文（Next.js 16：params 为 Promise）。 */
function ctxProject(projectId: string): { params: Promise<{ projectId: string }> } {
  return { params: Promise.resolve({ projectId }) };
}

/** 任务动态段上下文（Next.js 16：params 为 Promise）。 */
function ctxTask(taskId: string): { params: Promise<{ taskId: string }> } {
  return { params: Promise.resolve({ taskId }) };
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

let cookie = "";
let userId = "";

/** 回收本 run 数据（FK onDelete:Restrict，须按 子→父 顺序删除；Task 先于 Project）。 */
async function cleanupRun(): Promise<void> {
  if (userId.length === 0) {
    const users = await testPrisma.user.findMany({
      where: { email: { contains: RUN_TAG } },
      select: { id: true },
    });
    if (users.length === 0) return;
    userId = users[0]!.id;
  }
  const projects = await testPrisma.project.findMany({
    where: { ownerId: userId },
    select: { id: true },
  });
  const projectIds = projects.map((p) => p.id);
  await testPrisma.activityLog.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.idempotencyRecord.deleteMany({ where: { userId } });
  await testPrisma.task.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await testPrisma.user.deleteMany({ where: { id: userId } });
  await testPrisma.verification.deleteMany({ where: { identifier: { contains: RUN_TAG } } });
}

beforeAll(async () => {
  await cleanupRun();
  await signUpVerified(EMAIL, NAME);
  cookie = await signIn(EMAIL);
  expect(cookie).toContain("session_token");
  const user = await testPrisma.user.findUniqueOrThrow({
    where: { email: EMAIL },
    select: { id: true },
  });
  userId = user.id;
}, 120_000);

afterEach(async () => {
  // 每个用例后回收项目/任务/活动（保留用户与会话），使各用例彼此隔离并避免配额累积。
  const projects = await testPrisma.project.findMany({
    where: { ownerId: userId },
    select: { id: true },
  });
  const projectIds = projects.map((p) => p.id);
  await testPrisma.activityLog.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.idempotencyRecord.deleteMany({ where: { userId } });
  await testPrisma.task.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.project.deleteMany({ where: { id: { in: projectIds } } });
});

afterAll(async () => {
  await cleanupRun();
  await testPrisma.$disconnect();
});

/* ── 领域辅助 ─────────────────────────────────────────────────────────── */

/** POST /projects 创建项目并断言 201，返回 ProjectDTO。 */
async function createProjectOk(name: string): Promise<ProjectDTO> {
  const response = await projectsRoute.POST(
    buildRequest("POST", `${BASE}/projects`, {
      cookie,
      body: { name, key: nextKey() },
      idempotencyKey: randomUUID(),
    }),
  );
  expect(response.status).toBe(201);
  return ProjectSuccess.parse((await response.json()) as unknown).data;
}

/** POST /projects/{id}/tasks 创建任务并断言 201，返回 TaskDTO。 */
async function createTaskOk(projectId: string, body: Record<string, unknown>): Promise<TaskDTO> {
  const response = await tasksRoute.POST(
    buildRequest("POST", `${BASE}/projects/${projectId}/tasks`, {
      cookie,
      body,
      idempotencyKey: randomUUID(),
    }),
    ctxProject(projectId),
  );
  expect(response.status).toBe(201);
  return TaskSuccess.parse((await response.json()) as unknown).data;
}

/** 计数某项目的活动（action 为枚举值，直接传入而非 StringFilter）。 */
async function countActivities(projectId: string, action?: ActivityAction): Promise<number> {
  return testPrisma.activityLog.count({
    where: action ? { projectId, action } : { projectId },
  });
}

/* ── T1: 创建项目 → PROJECT_CREATED ──────────────────────────────────── */

describe("活动随事务写入 · 项目", () => {
  it("创建项目成功 → 恰好 1 条 PROJECT_CREATED，metadata 为空对象", async () => {
    const project = await createProjectOk("活动测试项目 A");

    expect(await countActivities(project.id)).toBe(1);
    expect(await countActivities(project.id, "PROJECT_CREATED")).toBe(1);

    const latest = await testPrisma.activityLog.findFirstOrThrow({
      where: { projectId: project.id, action: "PROJECT_CREATED" },
      orderBy: { createdAt: "desc" },
    });
    expect(latest.entityId).toBe(project.id);
    expect(latest.actorId).toBe(userId);
    expect(latest.metadata).toEqual({});
  });

  it("归档项目 → 恰好 1 条 PROJECT_ARCHIVED + version bump", async () => {
    const project = await createProjectOk("活动测试项目 · 归档");
    const before = await countActivities(project.id, "PROJECT_ARCHIVED");

    const response = await projectRoute.PATCH(
      buildRequest("PATCH", `${BASE}/projects/${project.id}`, {
        cookie,
        body: { archived: true, expectedVersion: project.version },
      }),
      ctxProject(project.id),
    );
    expect(response.status).toBe(200);

    expect(await countActivities(project.id, "PROJECT_ARCHIVED")).toBe(before + 1);
    const row = await testPrisma.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { archivedAt: true, version: true },
    });
    expect(row.archivedAt).toBeTruthy();
    expect(Number(row.version)).toBe(Number(project.version) + 1);
  });
});

/* ── T2: 创建任务 → TASK_CREATED ──────────────────────────────────── */

describe("活动随事务写入 · 任务", () => {
  it("创建任务成功 → 恰好 1 条 TASK_CREATED，metadata.taskIdentifier 正确", async () => {
    const project = await createProjectOk("活动测试项目 B");
    const task = await createTaskOk(project.id, { title: "活动测试任务" });

    expect(await countActivities(project.id, "TASK_CREATED")).toBe(1);

    const latest = await testPrisma.activityLog.findFirstOrThrow({
      where: { projectId: project.id, action: "TASK_CREATED", entityId: task.id },
      orderBy: { createdAt: "desc" },
    });
    // metadata 为 jsonb（JsonValue），读取后做类型收窄再断言白名单字段。
    const meta = latest.metadata as Record<string, unknown> | null;
    expect(meta).not.toBeNull();
    expect(typeof meta!.taskIdentifier).toBe("string");
    expect(meta!.taskIdentifier).toBe(`${project.key}-${task.number}`);
  });

  it("有变化 PATCH（改 status）→ 恰好 1 条 TASK_UPDATED + version bump", async () => {
    const project = await createProjectOk("活动测试项目 C");
    const task = await createTaskOk(project.id, { title: "待办任务" });
    const before = await countActivities(project.id, "TASK_UPDATED");

    const response = await taskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/tasks/${task.id}`, {
        cookie,
        body: { status: "IN_PROGRESS", expectedVersion: task.version },
      }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(200);

    expect(await countActivities(project.id, "TASK_UPDATED")).toBe(before + 1);
    const row = await testPrisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { version: true, status: true },
    });
    expect(row.status).toBe("IN_PROGRESS");
    expect(Number(row.version)).toBe(Number(task.version) + 1);
  });

  it("无语义变化 PATCH（status 与现值相同）→ 不写活动、不 bump version", async () => {
    const project = await createProjectOk("活动测试项目 D");
    const task = await createTaskOk(project.id, { title: "无变化任务", status: "TODO" });
    const before = await countActivities(project.id, "TASK_UPDATED");

    const response = await taskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/tasks/${task.id}`, {
        cookie,
        body: { status: "TODO", expectedVersion: task.version },
      }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(200);

    expect(await countActivities(project.id, "TASK_UPDATED")).toBe(before);
    const row = await testPrisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { version: true },
    });
    expect(Number(row.version)).toBe(Number(task.version));
  });
});

/* ── T3: 业务失败 → 事务回滚无残留 ──────────────────────────────────── */

describe("业务失败 → 事务回滚无残留", () => {
  it("expectedVersion 不符 → 409 VERSION_CONFLICT 且不写任何活动", async () => {
    const project = await createProjectOk("活动测试项目 · 回滚");
    const task = await createTaskOk(project.id, { title: "回滚验证任务" });

    // 基线：项目创建 + 任务创建各 1 条，共 2 条活动。
    const totalBefore = await countActivities(project.id);
    expect(totalBefore).toBe(2);

    const response = await taskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/tasks/${task.id}`, {
        cookie,
        body: { status: "IN_PROGRESS", expectedVersion: task.version + 100 },
      }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(409);

    // 失败事务回滚：既无 TASK_UPDATED，也无任何其它残留活动。
    expect(await countActivities(project.id, "TASK_UPDATED")).toBe(0);
    expect(await countActivities(project.id)).toBe(totalBefore);

    // 任务本身也未被修改（version/status 不变）。
    const row = await testPrisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { version: true, status: true },
    });
    expect(Number(row.version)).toBe(Number(task.version));
    expect(row.status).toBe("TODO");
  });

  it("createProject 业务失败（409 PROJECT_KEY_TAKEN）→ 幂等记录不落库（count 未增）", async () => {
    const key = nextKey();
    // 先成功占用该 key（写入 1 条幂等记录）。
    const firstRes = await projectsRoute.POST(
      buildRequest("POST", `${BASE}/projects`, {
        cookie,
        body: { name: "占用 key 项目", key },
        idempotencyKey: randomUUID(),
      }),
    );
    expect(firstRes.status).toBe(201);

    const before = await testPrisma.idempotencyRecord.count({ where: { userId } });

    // 同 key、不同 Idempotency-Key → 409 PROJECT_KEY_TAKEN（业务失败，事务回滚）。
    const failRes = await projectsRoute.POST(
      buildRequest("POST", `${BASE}/projects`, {
        cookie,
        body: { name: "重复 key 项目", key },
        idempotencyKey: randomUUID(),
      }),
    );
    expect(failRes.status).toBe(409);
    const err = (await failRes.json()) as { error?: { code?: string } };
    expect(err.error?.code).toBe("PROJECT_KEY_TAKEN");

    // 业务失败的幂等记录绝不落库：count 与失败前完全一致（commitIdempotency 未达成即回滚）。
    const after = await testPrisma.idempotencyRecord.count({ where: { userId } });
    expect(after).toBe(before);
  });

  it("createTask 业务失败（409 归档项目）→ nextTaskNumber/boardVersion/Task 行数/活动均不变", async () => {
    const project = await createProjectOk("回滚 · 归档后创建");
    // 归档项目使其只读。
    const archRes = await projectRoute.PATCH(
      buildRequest("PATCH", `${BASE}/projects/${project.id}`, {
        cookie,
        body: { archived: true, expectedVersion: project.version },
      }),
      ctxProject(project.id),
    );
    expect(archRes.status).toBe(200);

    const projBefore = await testPrisma.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { nextTaskNumber: true, boardVersion: true },
    });
    const taskCountBefore = await testPrisma.task.count({ where: { projectId: project.id } });
    const activityBefore = await countActivities(project.id);

    // 归档项目创建任务 → 409 PROJECT_ARCHIVED（业务失败，事务回滚）。
    const failRes = await tasksRoute.POST(
      buildRequest("POST", `${BASE}/projects/${project.id}/tasks`, {
        cookie,
        body: { title: "归档后任务" },
        idempotencyKey: randomUUID(),
      }),
      ctxProject(project.id),
    );
    expect(failRes.status).toBe(409);
    const err = (await failRes.json()) as { error?: { code?: string } };
    expect(err.error?.code).toBe("PROJECT_ARCHIVED");

    // 计数器与看板版本完全未推进，Task 行数与活动数不变。
    const projAfter = await testPrisma.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { nextTaskNumber: true, boardVersion: true },
    });
    expect(projAfter.nextTaskNumber).toBe(projBefore.nextTaskNumber);
    expect(projAfter.boardVersion).toBe(projBefore.boardVersion);
    expect(await testPrisma.task.count({ where: { projectId: project.id } })).toBe(
      taskCountBefore,
    );
    expect(await countActivities(project.id)).toBe(activityBefore);
  });

  it("createTask 业务失败（422 ASSIGNEE_NOT_MEMBER）→ nextTaskNumber/boardVersion/Task 行数/活动均不变", async () => {
    const project = await createProjectOk("回滚 · 非法负责人");

    const projBefore = await testPrisma.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { nextTaskNumber: true, boardVersion: true },
    });
    const taskCountBefore = await testPrisma.task.count({ where: { projectId: project.id } });
    const activityBefore = await countActivities(project.id);

    // assigneeId 为合法格式但非项目成员 → 422 ASSIGNEE_NOT_MEMBER（业务失败，事务回滚）。
    const failRes = await tasksRoute.POST(
      buildRequest("POST", `${BASE}/projects/${project.id}/tasks`, {
        cookie,
        body: { title: "非法分配任务", assigneeId: randomUUID() },
        idempotencyKey: randomUUID(),
      }),
      ctxProject(project.id),
    );
    expect(failRes.status).toBe(422);
    const err = (await failRes.json()) as { error?: { code?: string } };
    expect(err.error?.code).toBe("ASSIGNEE_NOT_MEMBER");

    // 取号发生在负责人校验之后，且整事务回滚：计数器/看板版本/行数/活动均不变。
    const projAfter = await testPrisma.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { nextTaskNumber: true, boardVersion: true },
    });
    expect(projAfter.nextTaskNumber).toBe(projBefore.nextTaskNumber);
    expect(projAfter.boardVersion).toBe(projBefore.boardVersion);
    expect(await testPrisma.task.count({ where: { projectId: project.id } })).toBe(
      taskCountBefore,
    );
    expect(await countActivities(project.id)).toBe(activityBefore);
  });
});

/* ── T4: 软删除 → TASK_DELETED ──────────────────────────────────── */

describe("软删除 → TASK_DELETED", () => {
  it("DELETE 成功 → 恰好 1 条 TASK_DELETED，deletedAt 非空 + version bump", async () => {
    const project = await createProjectOk("活动测试项目 · 删除");
    const task = await createTaskOk(project.id, { title: "待删除任务" });
    const before = await countActivities(project.id, "TASK_DELETED");

    const response = await taskRoute.DELETE(
      buildRequest("DELETE", `${BASE}/tasks/${task.id}?expectedVersion=${task.version}`, {
        cookie,
      }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(200);
    const deleted = DeletedTaskSuccess.parse((await response.json()) as unknown).data;
    expect(deleted.version).toBe(Number(task.version) + 1);

    expect(await countActivities(project.id, "TASK_DELETED")).toBe(before + 1);
    const row = await testPrisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { deletedAt: true, version: true },
    });
    expect(row.deletedAt).toBeTruthy();
    expect(Number(row.version)).toBe(Number(task.version) + 1);
  });
});

/* ── T5: 恢复 → TASK_RESTORED ──────────────────────────────────── */

describe("恢复 → TASK_RESTORED", () => {
  it("先软删除再恢复 → 恰好 1 条 TASK_RESTORED，deletedAt 归零", async () => {
    const project = await createProjectOk("活动测试项目 · 恢复");
    const task = await createTaskOk(project.id, { title: "待恢复任务" });

    // 先软删除（恢复要求任务处于已删除态）。
    const delRes = await taskRoute.DELETE(
      buildRequest("DELETE", `${BASE}/tasks/${task.id}?expectedVersion=${task.version}`, {
        cookie,
      }),
      ctxTask(task.id),
    );
    expect(delRes.status).toBe(200);
    const deletedVersion = DeletedTaskSuccess.parse((await delRes.json()) as unknown).data.version;

    const before = await countActivities(project.id, "TASK_RESTORED");
    const restoreRes = await restoreRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task.id}/restore`, {
        cookie,
        body: { expectedVersion: deletedVersion },
        idempotencyKey: randomUUID(),
      }),
      ctxTask(task.id),
    );
    expect(restoreRes.status).toBe(200);

    expect(await countActivities(project.id, "TASK_RESTORED")).toBe(before + 1);
    const row = await testPrisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { deletedAt: true },
    });
    expect(row.deletedAt).toBeNull();
  });
});
