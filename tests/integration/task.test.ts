import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import {
  DeletedTaskSchema,
  ErrorResponseSchema,
  ListResponseSchema,
  ProjectSchema,
  SuccessResponseSchema,
  TaskSchema,
  TaskSummarySchema,
  type ErrorResponse,
  type ProjectDTO,
  type TaskDTO,
} from "@/contracts";
import { getEnv, parseEnv } from "@/server/env";
import { REQUEST_ID_HEADER } from "@/server/http/request-id";

/**
 * `/api/v1/.../tasks*` 与 `/api/v1/tasks/[taskId]*` 集成测试（M2 / ORB-008：任务生命周期）。
 *
 * 与 project.test.ts / me.test.ts 同一套基础设施：在**独立测试库 orbit_test**
 * （TEST_DATABASE_URL）上直接调用 Next.js route handler（纯 `(Request, ctx?) => Response`），
 * 覆盖真实路由编排（请求 ID → Origin → 会话 → schema → 领域服务 → 信封）而不启 HTTP 服务。
 *
 * ⚠️ 单例隔离（必须在动态 import 前）：
 *  - `vi.mock("@/server/db/prisma")` 把应用 Prisma 单例换成绑定 TEST_DATABASE_URL 的客户端；
 *  - `APP_ENV="test"` 关闭 Better Auth 内置限流；
 *  - 会话夹具用**同一个** auth 单例签发 cookie。
 *
 * 覆盖场景（docs/01 §4/§6、docs/04 §3/§4/§5、docs/05 §4/§5/§6）：
 *  创建 201+identifier / 编号递增 / 非成员 404 / 归档创建 409 / 超配额 422 /
 *  assignee 非成员 422 / 改任务 version++ / expectedVersion 不符 409+currentVersion /
 *  进 DONE completedAt / 离开 DONE 清空 / 重复同 status 不刷新 / 无语义变化 version 不变 /
 *  软删除+列表不可见 / 恢复+追加列尾 / 恢复超配额 422 / 非 owner·创建者删除 403 / 幂等重放 200。
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
const tasksRoute = await import("@/app/api/v1/projects/[projectId]/tasks/route");
const taskRoute = await import("@/app/api/v1/tasks/[taskId]/route");
const restoreRoute = await import("@/app/api/v1/tasks/[taskId]/restore/route");
const { auth } = await import("@/server/auth");
const { prisma: testPrisma } = await import("@/server/db/prisma");

/* ── 夹具常量 ─────────────────────────────────────────────────────────── */

const RUN_TAG = `orb008-${Date.now()}`;
const domain = "orbit.test";
const EMAIL_A = `${RUN_TAG}-a@${domain}`; // 主账户：项目 owner、任务创建者
const EMAIL_B = `${RUN_TAG}-b@${domain}`; // 成员账户：可创建/编辑，非创建者不可删
const EMAIL_C = `${RUN_TAG}-c@${domain}`; // 非成员账户：404 / assignee 非成员 422
const PASSWORD = "Str0ng!Passw0rd-OrbitTest";
const NAME_A = "任务主";
const NAME_B = "成员乙";
const NAME_C = "外人丙";

const BASE = `${env.BETTER_AUTH_URL}/api/v1`;
const TRUSTED_ORIGIN =
  env.AUTH_TRUSTED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0] ?? env.BETTER_AUTH_URL;

/** key 前缀：run 唯一，确保跨运行不撞 DB 全局唯一约束。 */
const KEY_PREFIX = `K${Date.now().toString(36).slice(-4).toUpperCase()}`;
let keyCounter = 0;
/** 生成合法且本次运行内唯一的项目 key（`/^[A-Z][A-Z0-9]{1,7}$/`，≤8 位）。 */
function nextKey(): string {
  keyCounter += 1;
  return `${KEY_PREFIX}${String(keyCounter).padStart(2, "0")}`.slice(0, 8);
}

/* ── 信封校验器（strict，形状不合契约直接抛错）────────────────────────── */
const ProjectSuccess = SuccessResponseSchema(ProjectSchema);
const TaskSuccess = SuccessResponseSchema(TaskSchema);
const TaskSummaryList = ListResponseSchema(TaskSummarySchema);
const DeletedTaskSuccess = SuccessResponseSchema(DeletedTaskSchema);

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

/** 项目动态段上下文（Next.js 16：params 为 Promise）。 */
function ctxProject(projectId: string): { params: Promise<{ projectId: string }> } {
  return { params: Promise.resolve({ projectId }) };
}

/** 任务动态段上下文（Next.js 16：params 为 Promise）。 */
function ctxTask(taskId: string): { params: Promise<{ taskId: string }> } {
  return { params: Promise.resolve({ taskId }) };
}

async function readError(response: Response): Promise<ErrorResponse> {
  return ErrorResponseSchema.parse((await response.json()) as unknown);
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
let cookieC = "";
let userAId = "";
let userBId = "";
let userCId = "";

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
  await testPrisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await testPrisma.user.deleteMany({ where: { id: { in: userIds } } });
  await testPrisma.verification.deleteMany({ where: { identifier: { contains: RUN_TAG } } });
}

beforeAll(async () => {
  await cleanup();
  await signUpVerified(EMAIL_A, NAME_A);
  await signUpVerified(EMAIL_B, NAME_B);
  await signUpVerified(EMAIL_C, NAME_C);
  cookieA = await signIn(EMAIL_A);
  cookieB = await signIn(EMAIL_B);
  cookieC = await signIn(EMAIL_C);
  expect(cookieA).toContain("session_token");
  const a = await testPrisma.user.findUniqueOrThrow({ where: { email: EMAIL_A } });
  const b = await testPrisma.user.findUniqueOrThrow({ where: { email: EMAIL_B } });
  const c = await testPrisma.user.findUniqueOrThrow({ where: { email: EMAIL_C } });
  userAId = a.id;
  userBId = b.id;
  userCId = c.id;
}, 120_000);

/**
 * 每个用例后重置项目/任务数据（保留用户/会话），使各用例彼此隔离，
 * 并避免跨用例累计撞上 MAX_ACTIVE_PROJECTS / MAX_OPEN_TASKS 配额。
 * 按 FK onDelete:Restrict 的 子→父 顺序删除（Task 先于 Project）。
 */
afterEach(async () => {
  const userIds = [userAId, userBId, userCId].filter((id) => id.length > 0);
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

/** POST /projects 创建项目并断言 201，返回 ProjectDTO。 */
async function createProjectOk(cookie: string, name: string): Promise<ProjectDTO> {
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

/** PATCH /projects/{id} 归档项目（owner）。 */
async function archiveProject(cookie: string, project: ProjectDTO): Promise<void> {
  const response = await projectRoute.PATCH(
    buildRequest("PATCH", `${BASE}/projects/${project.id}`, {
      cookie,
      body: { expectedVersion: project.version, archived: true },
    }),
    ctxProject(project.id),
  );
  expect(response.status).toBe(200);
}

/** 直接把某用户加为项目成员（ProjectMember 仅存非 owner 成员）。 */
async function addMember(projectId: string, userId: string): Promise<void> {
  await testPrisma.projectMember.create({ data: { projectId, userId } });
}

/** POST /projects/{id}/tasks 创建任务并断言 201，返回 TaskDTO。 */
async function createTaskOk(
  cookie: string,
  projectId: string,
  body: Record<string, unknown>,
  idempotencyKey: string = randomUUID(),
): Promise<{ task: TaskDTO; idempotencyKey: string }> {
  const response = await tasksRoute.POST(
    buildRequest("POST", `${BASE}/projects/${projectId}/tasks`, {
      cookie,
      body,
      idempotencyKey,
    }),
    ctxProject(projectId),
  );
  expect(response.status).toBe(201);
  const parsed = TaskSuccess.parse((await response.json()) as unknown);
  return { task: parsed.data, idempotencyKey };
}

/**
 * 直接批量种入未删除任务（绕过 HTTP，用于配额场景）。
 * 号段从 startNumber 起，避免与 HTTP 创建的编号撞 @@unique([projectId, number])。
 */
async function seedOpenTasks(
  projectId: string,
  creatorId: string,
  count: number,
  startNumber = 1,
): Promise<void> {
  const data: Prisma.TaskCreateManyInput[] = [];
  for (let i = 0; i < count; i += 1) {
    const number = startNumber + i;
    data.push({
      projectId,
      number,
      creatorId,
      title: `种子任务 ${number}`,
      position: BigInt(number) * 1024n,
      status: "TODO",
      priority: "NONE",
      version: 1,
    });
  }
  await testPrisma.task.createMany({ data });
}

/* ── 1. POST /projects/{id}/tasks：创建 / 编号 / 授权 / 配额 ────────────── */

describe("POST tasks：创建与编号", () => {
  it("创建成功 → 201 + 合法 TaskDTO（identifier=KEY-1、默认 TODO/MEDIUM、version=1、无 position）", async () => {
    const project = await createProjectOk(cookieA, "任务项目");
    const { task } = await createTaskOk(cookieA, project.id, { title: "  首个任务  " });
    expect(task).toMatchObject({
      projectId: project.id,
      number: 1,
      identifier: `${project.key}-1`,
      title: "首个任务", // 服务端 trim
      description: "",
      status: "TODO",
      priority: "MEDIUM", // docs/01 §6：默认 MEDIUM
      assignee: null,
      dueDate: null,
      completedAt: null,
      version: 1,
      subtaskTotal: 0,
      commentCount: 0,
      deletedAt: null,
    });
    expect(task.creator.id).toBe(userAId);
    // position 绝不入 DTO（TaskSummarySchema strict，无 position 字段）。
    expect("position" in task).toBe(false);
    // 落库 + 活动同事务。
    const activity = await testPrisma.activityLog.findFirst({
      where: { projectId: project.id, action: "TASK_CREATED" },
    });
    expect(activity).not.toBeNull();
  });

  it("连续创建 → number 严格递增、identifier 唯一", async () => {
    const project = await createProjectOk(cookieA, "编号项目");
    const t1 = await createTaskOk(cookieA, project.id, { title: "任务一" });
    const t2 = await createTaskOk(cookieA, project.id, { title: "任务二" });
    const t3 = await createTaskOk(cookieA, project.id, { title: "任务三" });
    expect([t1.task.number, t2.task.number, t3.task.number]).toEqual([1, 2, 3]);
    const ids = [t1.task.identifier, t2.task.identifier, t3.task.identifier];
    expect(ids).toEqual([`${project.key}-1`, `${project.key}-2`, `${project.key}-3`]);
    expect(new Set(ids).size).toBe(3);
  });

  it("成员（非 owner）可创建任务 → 201", async () => {
    const project = await createProjectOk(cookieA, "成员创建");
    await addMember(project.id, userBId);
    const { task } = await createTaskOk(cookieB, project.id, { title: "成员任务" });
    expect(task.creator.id).toBe(userBId);
  });

  it("assignee 为项目成员 → 201，assignee 回填 UserSummary", async () => {
    const project = await createProjectOk(cookieA, "分配项目");
    await addMember(project.id, userBId);
    const { task } = await createTaskOk(cookieA, project.id, {
      title: "分配给乙",
      assigneeId: userBId,
    });
    expect(task.assignee).not.toBeNull();
    expect(task.assignee?.id).toBe(userBId);
  });

  it("assignee 非成员 → 422 ASSIGNEE_NOT_MEMBER", async () => {
    const project = await createProjectOk(cookieA, "非法分配");
    const response = await tasksRoute.POST(
      buildRequest("POST", `${BASE}/projects/${project.id}/tasks`, {
        cookie: cookieA,
        body: { title: "分配给外人", assigneeId: userCId },
        idempotencyKey: randomUUID(),
      }),
      ctxProject(project.id),
    );
    expect(response.status).toBe(422);
    expect((await readError(response)).error.code).toBe("ASSIGNEE_NOT_MEMBER");
  });

  it("非成员创建任务 → 404 NOT_FOUND（不可见收敛）", async () => {
    const project = await createProjectOk(cookieA, "封闭项目");
    const response = await tasksRoute.POST(
      buildRequest("POST", `${BASE}/projects/${project.id}/tasks`, {
        cookie: cookieC,
        body: { title: "外人任务" },
        idempotencyKey: randomUUID(),
      }),
      ctxProject(project.id),
    );
    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("NOT_FOUND");
  });

  it("归档项目创建任务 → 409 PROJECT_ARCHIVED", async () => {
    const project = await createProjectOk(cookieA, "归档项目");
    await archiveProject(cookieA, project);
    const response = await tasksRoute.POST(
      buildRequest("POST", `${BASE}/projects/${project.id}/tasks`, {
        cookie: cookieA,
        body: { title: "归档后任务" },
        idempotencyKey: randomUUID(),
      }),
      ctxProject(project.id),
    );
    expect(response.status).toBe(409);
    expect((await readError(response)).error.code).toBe("PROJECT_ARCHIVED");
  });

  it("超 1000 未删除任务配额 → 422 LIMIT_EXCEEDED", async () => {
    const project = await createProjectOk(cookieA, "配额项目");
    await seedOpenTasks(project.id, userAId, 1000, 1);
    const response = await tasksRoute.POST(
      buildRequest("POST", `${BASE}/projects/${project.id}/tasks`, {
        cookie: cookieA,
        body: { title: "超额任务" },
        idempotencyKey: randomUUID(),
      }),
      ctxProject(project.id),
    );
    expect(response.status).toBe(422);
    expect((await readError(response)).error.code).toBe("LIMIT_EXCEEDED");
  }, 60_000);

  it("幂等：同 key 同 body 重放 → 200 原结果（同一任务 id，不重复创建）", async () => {
    const project = await createProjectOk(cookieA, "幂等任务项目");
    const idempotencyKey = randomUUID();
    const body = { title: "幂等任务" };
    const first = await tasksRoute.POST(
      buildRequest("POST", `${BASE}/projects/${project.id}/tasks`, {
        cookie: cookieA,
        body,
        idempotencyKey,
      }),
      ctxProject(project.id),
    );
    expect(first.status).toBe(201);
    const firstData = TaskSuccess.parse((await first.json()) as unknown).data;

    const second = await tasksRoute.POST(
      buildRequest("POST", `${BASE}/projects/${project.id}/tasks`, {
        cookie: cookieA,
        body,
        idempotencyKey,
      }),
      ctxProject(project.id),
    );
    expect(second.status).toBe(200); // 重放 200，非 201
    const secondData = TaskSuccess.parse((await second.json()) as unknown).data;
    expect(secondData.id).toBe(firstData.id);
    expect(secondData.number).toBe(firstData.number);

    const count = await testPrisma.task.count({ where: { projectId: project.id } });
    expect(count).toBe(1);
  });
});

/* ── 2. GET tasks：读取 / 列表可见性 ───────────────────────────────────── */

describe("GET tasks：读取与列表", () => {
  it("GET /tasks/{id} 成员读取 → 200 + TaskDTO（含 description）", async () => {
    const project = await createProjectOk(cookieA, "读取项目");
    const { task } = await createTaskOk(cookieA, project.id, {
      title: "详情任务",
      description: "描述内容",
    });
    const response = await taskRoute.GET(
      buildRequest("GET", `${BASE}/tasks/${task.id}`, { cookie: cookieA }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(200);
    const data = TaskSuccess.parse((await response.json()) as unknown).data;
    expect(data.id).toBe(task.id);
    expect(data.description).toBe("描述内容");
  });

  it("非成员读取单任务 → 404 NOT_FOUND", async () => {
    const project = await createProjectOk(cookieA, "封闭读取");
    const { task } = await createTaskOk(cookieA, project.id, { title: "秘密任务" });
    const response = await taskRoute.GET(
      buildRequest("GET", `${BASE}/tasks/${task.id}`, { cookie: cookieC }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("NOT_FOUND");
  });

  it("列表默认排除软删除任务；deleted=only 只返回软删除任务", async () => {
    const project = await createProjectOk(cookieA, "列表项目");
    const keep = await createTaskOk(cookieA, project.id, { title: "保留任务" });
    const gone = await createTaskOk(cookieA, project.id, { title: "将删任务" });
    const delRes = await taskRoute.DELETE(
      buildRequest("DELETE", `${BASE}/tasks/${gone.task.id}?expectedVersion=1`, {
        cookie: cookieA,
      }),
      ctxTask(gone.task.id),
    );
    expect(delRes.status).toBe(200);

    const listRes = await tasksRoute.GET(
      buildRequest("GET", `${BASE}/projects/${project.id}/tasks`, { cookie: cookieA }),
      ctxProject(project.id),
    );
    expect(listRes.status).toBe(200);
    const list = TaskSummaryList.parse((await listRes.json()) as unknown).data;
    expect(list.map((t) => t.id)).toEqual([keep.task.id]);

    const onlyRes = await tasksRoute.GET(
      buildRequest("GET", `${BASE}/projects/${project.id}/tasks?deleted=only`, {
        cookie: cookieA,
      }),
      ctxProject(project.id),
    );
    const only = TaskSummaryList.parse((await onlyRes.json()) as unknown).data;
    expect(only.map((t) => t.id)).toEqual([gone.task.id]);
  });
});

/* ── 3. PATCH /tasks/{id}：更新 / 版本 / 状态机 ────────────────────────── */

describe("PATCH tasks：更新与状态机", () => {
  it("改标题 → 200 + version++（一次 PATCH 只 +1）", async () => {
    const project = await createProjectOk(cookieA, "改标题项目");
    const { task } = await createTaskOk(cookieA, project.id, { title: "原标题" });
    const response = await taskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/tasks/${task.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 1, title: "新标题" },
      }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(200);
    const data = TaskSuccess.parse((await response.json()) as unknown).data;
    expect(data.title).toBe("新标题");
    expect(data.version).toBe(2);
  });

  it("expectedVersion 不符 → 409 VERSION_CONFLICT + currentVersion", async () => {
    const project = await createProjectOk(cookieA, "版本冲突项目");
    const { task } = await createTaskOk(cookieA, project.id, { title: "冲突任务" });
    const response = await taskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/tasks/${task.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 99, title: "改名" },
      }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(409);
    const envelope = await readError(response);
    expect(envelope.error.code).toBe("VERSION_CONFLICT");
    expect(envelope.error.currentVersion).toBe(1);
  });

  it("status→DONE → completedAt 非空；离开 DONE → completedAt 为 null", async () => {
    const project = await createProjectOk(cookieA, "状态机项目");
    const { task } = await createTaskOk(cookieA, project.id, { title: "状态任务" });

    const doneRes = await taskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/tasks/${task.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 1, status: "DONE" },
      }),
      ctxTask(task.id),
    );
    expect(doneRes.status).toBe(200);
    const done = TaskSuccess.parse((await doneRes.json()) as unknown).data;
    expect(done.status).toBe("DONE");
    expect(done.completedAt).not.toBeNull();
    expect(done.version).toBe(2);

    const reopenRes = await taskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/tasks/${task.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 2, status: "TODO" },
      }),
      ctxTask(task.id),
    );
    const reopened = TaskSuccess.parse((await reopenRes.json()) as unknown).data;
    expect(reopened.status).toBe("TODO");
    expect(reopened.completedAt).toBeNull();
    expect(reopened.version).toBe(3);
  });

  it("重复设相同 status → completedAt 不刷新、version 不变（无语义变化）", async () => {
    const project = await createProjectOk(cookieA, "重复状态项目");
    const { task } = await createTaskOk(cookieA, project.id, { title: "重复任务" });
    const doneRes = await taskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/tasks/${task.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 1, status: "DONE" },
      }),
      ctxTask(task.id),
    );
    const done = TaskSuccess.parse((await doneRes.json()) as unknown).data;
    expect(done.completedAt).not.toBeNull();

    // 再次设同一 status DONE：规范化后无变化 → 不 bump version、不刷新 completedAt。
    const againRes = await taskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/tasks/${task.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 2, status: "DONE" },
      }),
      ctxTask(task.id),
    );
    expect(againRes.status).toBe(200);
    const again = TaskSuccess.parse((await againRes.json()) as unknown).data;
    expect(again.version).toBe(2); // 未变
    expect(again.completedAt).toBe(done.completedAt); // 未刷新
  });

  it("无语义变化（改成同值标题）→ version 不变", async () => {
    const project = await createProjectOk(cookieA, "无变化项目");
    const { task } = await createTaskOk(cookieA, project.id, { title: "同值任务" });
    const before = await testPrisma.activityLog.count({
      where: { projectId: project.id, action: "TASK_UPDATED" },
    });
    const response = await taskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/tasks/${task.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 1, title: "同值任务" },
      }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(200);
    const data = TaskSuccess.parse((await response.json()) as unknown).data;
    expect(data.version).toBe(1); // 未 bump
    const after = await testPrisma.activityLog.count({
      where: { projectId: project.id, action: "TASK_UPDATED" },
    });
    expect(after).toBe(before); // 未写活动
  });

  it("assignee 改成非成员 → 422；改成 null 取消分配 → 200", async () => {
    const project = await createProjectOk(cookieA, "改分配项目");
    await addMember(project.id, userBId);
    const { task } = await createTaskOk(cookieA, project.id, {
      title: "改分配",
      assigneeId: userBId,
    });
    const bad = await taskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/tasks/${task.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 1, assigneeId: userCId },
      }),
      ctxTask(task.id),
    );
    expect(bad.status).toBe(422);
    expect((await readError(bad)).error.code).toBe("ASSIGNEE_NOT_MEMBER");

    const clear = await taskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/tasks/${task.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 1, assigneeId: null },
      }),
      ctxTask(task.id),
    );
    expect(clear.status).toBe(200);
    const cleared = TaskSuccess.parse((await clear.json()) as unknown).data;
    expect(cleared.assignee).toBeNull();
    expect(cleared.version).toBe(2);
  });
});

/* ── 4. DELETE /tasks/{id}：软删除与权限 ───────────────────────────────── */

describe("DELETE tasks：软删除与权限", () => {
  it("owner 软删除 → 200 DeletedTask（version++、deletedAt 非空）", async () => {
    const project = await createProjectOk(cookieA, "删除项目");
    const { task } = await createTaskOk(cookieA, project.id, { title: "待删任务" });
    const response = await taskRoute.DELETE(
      buildRequest("DELETE", `${BASE}/tasks/${task.id}?expectedVersion=1`, {
        cookie: cookieA,
      }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(200);
    const data = DeletedTaskSuccess.parse((await response.json()) as unknown).data;
    expect(data.id).toBe(task.id);
    expect(data.version).toBe(2);
    expect(data.deletedAt).not.toBeNull();

    // 软删除后 GET 单任务 → 404（回收站语义）。
    const getRes = await taskRoute.GET(
      buildRequest("GET", `${BASE}/tasks/${task.id}`, { cookie: cookieA }),
      ctxTask(task.id),
    );
    expect(getRes.status).toBe(404);
  });

  it("缺少 expectedVersion 查询参数 → 400 VALIDATION_ERROR", async () => {
    const project = await createProjectOk(cookieA, "缺版本删除");
    const { task } = await createTaskOk(cookieA, project.id, { title: "缺版本任务" });
    const response = await taskRoute.DELETE(
      buildRequest("DELETE", `${BASE}/tasks/${task.id}`, { cookie: cookieA }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(400);
    expect((await readError(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("非 owner·非创建者的成员删除 → 403 FORBIDDEN", async () => {
    const project = await createProjectOk(cookieA, "越权删除项目");
    await addMember(project.id, userBId);
    // A（owner）创建任务；B（成员，非创建者）删除 → 403。
    const { task } = await createTaskOk(cookieA, project.id, { title: "A 的任务" });
    const response = await taskRoute.DELETE(
      buildRequest("DELETE", `${BASE}/tasks/${task.id}?expectedVersion=1`, { cookie: cookieB }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(403);
    expect((await readError(response)).error.code).toBe("FORBIDDEN");
  });

  it("创建者（成员）可删除自己创建的任务 → 200", async () => {
    const project = await createProjectOk(cookieA, "创建者删除项目");
    await addMember(project.id, userBId);
    const { task } = await createTaskOk(cookieB, project.id, { title: "B 的任务" });
    const response = await taskRoute.DELETE(
      buildRequest("DELETE", `${BASE}/tasks/${task.id}?expectedVersion=1`, { cookie: cookieB }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(200);
  });
});

/* ── 5. POST /tasks/{id}/restore：恢复与配额 ───────────────────────────── */

describe("POST tasks/restore：恢复与配额", () => {
  it("恢复软删除任务 → 200 TaskDTO + position 追加到原列尾", async () => {
    const project = await createProjectOk(cookieA, "恢复项目");
    await addMember(project.id, userBId);
    // 先建一个同列（TODO）任务占据列尾，再建待删任务。
    await createTaskOk(cookieA, project.id, { title: "占位任务" });
    const { task } = await createTaskOk(cookieA, project.id, {
      title: "待删恢复",
      assigneeId: userBId,
    });
    const delRes = await taskRoute.DELETE(
      buildRequest("DELETE", `${BASE}/tasks/${task.id}?expectedVersion=1`, { cookie: cookieA }),
      ctxTask(task.id),
    );
    const deleted = DeletedTaskSuccess.parse((await delRes.json()) as unknown).data;

    const response = await restoreRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task.id}/restore`, {
        cookie: cookieA,
        body: { expectedVersion: deleted.version },
        idempotencyKey: randomUUID(),
      }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(200);
    const restored = TaskSuccess.parse((await response.json()) as unknown).data;
    expect(restored.id).toBe(task.id);
    expect(restored.deletedAt).toBeNull();
    expect(restored.version).toBe(deleted.version + 1);
    expect(restored.assignee?.id).toBe(userBId); // 负责人仍在项目 → 保留

    // position 落到 TODO 列尾（追加语义）。
    const row = await testPrisma.task.findUniqueOrThrow({ where: { id: task.id } });
    const maxPos = await testPrisma.task.aggregate({
      where: { projectId: project.id, deletedAt: null, status: row.status },
      _max: { position: true },
    });
    expect(row.position).toBe(maxPos._max.position);
  });

  it("恢复时原负责人已退出项目 → assignee 置空", async () => {
    const project = await createProjectOk(cookieA, "退项目恢复");
    await addMember(project.id, userBId);
    const { task } = await createTaskOk(cookieA, project.id, {
      title: "乙负责",
      assigneeId: userBId,
    });
    const delRes = await taskRoute.DELETE(
      buildRequest("DELETE", `${BASE}/tasks/${task.id}?expectedVersion=1`, { cookie: cookieA }),
      ctxTask(task.id),
    );
    const deleted = DeletedTaskSuccess.parse((await delRes.json()) as unknown).data;
    // 乙退出项目。
    await testPrisma.projectMember.deleteMany({
      where: { projectId: project.id, userId: userBId },
    });

    const response = await restoreRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task.id}/restore`, {
        cookie: cookieA,
        body: { expectedVersion: deleted.version },
        idempotencyKey: randomUUID(),
      }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(200);
    const restored = TaskSuccess.parse((await response.json()) as unknown).data;
    expect(restored.assignee).toBeNull();
  });

  it("未删除任务恢复 → 404（回收站语义）", async () => {
    const project = await createProjectOk(cookieA, "误恢复项目");
    const { task } = await createTaskOk(cookieA, project.id, { title: "未删任务" });
    const response = await restoreRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task.id}/restore`, {
        cookie: cookieA,
        body: { expectedVersion: 1 },
        idempotencyKey: randomUUID(),
      }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("NOT_FOUND");
  });

  it("恢复超配额（已 1000 未删除）→ 422 LIMIT_EXCEEDED", async () => {
    const project = await createProjectOk(cookieA, "恢复配额项目");
    // 先建并软删一个任务（version→2），再种满 1000 未删除任务，恢复时应超额。
    const { task } = await createTaskOk(cookieA, project.id, { title: "待恢复" });
    const delRes = await taskRoute.DELETE(
      buildRequest("DELETE", `${BASE}/tasks/${task.id}?expectedVersion=1`, { cookie: cookieA }),
      ctxTask(task.id),
    );
    const deleted = DeletedTaskSuccess.parse((await delRes.json()) as unknown).data;
    await seedOpenTasks(project.id, userAId, 1000, 2);

    const response = await restoreRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task.id}/restore`, {
        cookie: cookieA,
        body: { expectedVersion: deleted.version },
        idempotencyKey: randomUUID(),
      }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(422);
    expect((await readError(response)).error.code).toBe("LIMIT_EXCEEDED");
  }, 60_000);

  it("非 owner·非创建者的成员恢复 → 403 FORBIDDEN", async () => {
    const project = await createProjectOk(cookieA, "越权恢复项目");
    await addMember(project.id, userBId);
    const { task } = await createTaskOk(cookieA, project.id, { title: "A 待恢复" });
    const delRes = await taskRoute.DELETE(
      buildRequest("DELETE", `${BASE}/tasks/${task.id}?expectedVersion=1`, { cookie: cookieA }),
      ctxTask(task.id),
    );
    const deleted = DeletedTaskSuccess.parse((await delRes.json()) as unknown).data;
    const response = await restoreRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task.id}/restore`, {
        cookie: cookieB,
        body: { expectedVersion: deleted.version },
        idempotencyKey: randomUUID(),
      }),
      ctxTask(task.id),
    );
    expect(response.status).toBe(403);
    expect((await readError(response)).error.code).toBe("FORBIDDEN");
  });
});

/* ── 6. openTaskCount 真实计数（S5.8）─────────────────────────────────── */

describe("Project.openTaskCount 真实计数", () => {
  it("GET /projects/{id} 反映未删除且未完成任务数", async () => {
    const project = await createProjectOk(cookieA, "计数项目");
    await createTaskOk(cookieA, project.id, { title: "未完成一" });
    await createTaskOk(cookieA, project.id, { title: "未完成二" });
    const doneTask = await createTaskOk(cookieA, project.id, { title: "已完成" });
    // 把一个任务标记 DONE（不计入 openTaskCount）。
    await taskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/tasks/${doneTask.task.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 1, status: "DONE" },
      }),
      ctxTask(doneTask.task.id),
    );

    const response = await projectRoute.GET(
      buildRequest("GET", `${BASE}/projects/${project.id}`, { cookie: cookieA }),
      ctxProject(project.id),
    );
    expect(response.status).toBe(200);
    const data = ProjectSuccess.parse((await response.json()) as unknown).data;
    expect(data.openTaskCount).toBe(2); // 3 建 - 1 DONE
  });
});


describe("M2 独立复核回归", () => {
  async function remove(task: TaskDTO, cookie = cookieA) {
    const res = await taskRoute.DELETE(buildRequest("DELETE", `${BASE}/tasks/${task.id}?expectedVersion=${task.version}`, { cookie }), ctxTask(task.id));
    expect(res.status).toBe(200);
    return DeletedTaskSuccess.parse(await res.json()).data;
  }
  function restore(taskId: string, version: number, key: string, cookie = cookieA) {
    return restoreRoute.POST(buildRequest("POST", `${BASE}/tasks/${taskId}/restore`, {
      cookie, body: { expectedVersion: version }, idempotencyKey: key,
    }), ctxTask(taskId));
  }
  it("恢复串行及并发重试只恢复一次，并保留新操作与删除态检查", async () => {
    const project = await createProjectOk(cookieA, "恢复重试");
    const { task } = await createTaskOk(cookieA, project.id, { title: "任务", description: "合成正文" });
    const deleted = await remove(task);
    const key = randomUUID();
    const boardBefore = (await testPrisma.project.findUniqueOrThrow({ where: { id: project.id } })).boardVersion;
    const responses = await Promise.all([restore(task.id, deleted.version, key), restore(task.id, deleted.version, key)]);
    expect(responses.map(res => res.status)).toEqual([200, 200]);
    const bodies = await Promise.all(responses.map(async res => TaskSuccess.parse(await res.json()).data));
    expect(bodies[0]).toEqual(bodies[1]);
    const retry = await restore(task.id, deleted.version, key);
    expect(retry.status).toBe(200);
    expect(TaskSuccess.parse(await retry.json()).data).toEqual(bodies[0]);
    expect((await testPrisma.task.findUniqueOrThrow({ where: { id: task.id } })).version).toBe(deleted.version + 1);
    expect((await testPrisma.project.findUniqueOrThrow({ where: { id: project.id } })).boardVersion).toBe(boardBefore + 1);
    expect(await testPrisma.activityLog.count({ where: { entityId: task.id, action: "TASK_RESTORED" } })).toBe(1);
    expect((await restore(task.id, deleted.version, randomUUID())).status).toBe(404);
    expect((await restore(task.id, deleted.version + 1, key)).status).toBe(409);
    await remove(bodies[0]!);
    expect((await restore(task.id, deleted.version, key)).status).toBe(404);
  });
  it("恢复缓存仍检查当前成员身份，成员移除后不能重放", async () => {
    const project = await createProjectOk(cookieA, "恢复授权");
    await addMember(project.id, userBId);
    const { task } = await createTaskOk(cookieB, project.id, { title: "成员创建任务" });
    const deleted = await remove(task, cookieB);
    const key = randomUUID();
    expect((await restore(task.id, deleted.version, key, cookieB)).status).toBe(200);
    await testPrisma.projectMember.deleteMany({ where: { projectId: project.id, userId: userBId } });
    expect((await restore(task.id, deleted.version, key, cookieB)).status).toBe(404);
  });
  it("创建缓存不得取回软删除正文或复活任务", async () => {
    const project = await createProjectOk(cookieA, "删除缓存");
    const body = { title: "任务", description: "不应从回收站接口泄露的合成正文" };
    const { task, idempotencyKey } = await createTaskOk(cookieA, project.id, body);
    await remove(task);
    const res = await tasksRoute.POST(buildRequest("POST", `${BASE}/projects/${project.id}/tasks`, { cookie: cookieA, body, idempotencyKey }), ctxProject(project.id));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(body.description);
    expect(await testPrisma.task.count({ where: { projectId: project.id } })).toBe(1);
    expect(await testPrisma.activityLog.count({ where: { entityId: task.id, action: "TASK_CREATED" } })).toBe(1);
  });
  it("逾期 API 使用账户时区，修改时区立即生效且排除 DONE", async () => {
    const project = await createProjectOk(cookieA, "日历时区");
    const instant = new Date(); instant.setUTCHours(6, 0, 0, 0);
    const utcDate = instant.toISOString().slice(0, 10);
    const yesterday = new Date(instant); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const localDate = yesterday.toISOString().slice(0, 10);
    const { task } = await createTaskOk(cookieA, project.id, { title: "本地今日截止", dueDate: localDate });
    await createTaskOk(cookieA, project.id, { title: "完成任务", dueDate: localDate, status: "DONE" });
    await createTaskOk(cookieA, project.id, { title: "UTC 今日截止", dueDate: utcDate });
    const originalZone = (await testPrisma.user.findUniqueOrThrow({ where: { id: userAId } })).timezone;
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(instant);
    try {
      async function overdueIn(zone: string) {
        await testPrisma.user.update({ where: { id: userAId }, data: { timezone: zone } });
        const res = await tasksRoute.GET(buildRequest("GET", `${BASE}/projects/${project.id}/tasks?overdue=true`, { cookie: cookieA }), ctxProject(project.id));
        expect(res.status).toBe(200);
        return TaskSummaryList.parse(await res.json()).data;
      }
      expect(await overdueIn("Pacific/Honolulu")).toEqual([]);
      expect((await overdueIn("Asia/Shanghai")).map(t => t.id)).toEqual([task.id]);
    } finally {
      vi.useRealTimers();
      await testPrisma.user.update({ where: { id: userAId }, data: { timezone: originalZone } });
    }
  });
});
