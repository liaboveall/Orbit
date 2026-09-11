import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import {
  ErrorResponseSchema,
  SuccessResponseSchema,
  ProjectSchema,
  TaskSchema,
  MoveResultSchema,
  BoardSchema,
  type ErrorResponse,
  type ProjectDTO,
  type TaskDTO,
} from "@/contracts";
import { getEnv, parseEnv } from "@/server/env";
import { REQUEST_ID_HEADER } from "@/server/http/request-id";

/**
 * `/api/v1/tasks/[taskId]/move` 集成测试（M3 Phase 3 / ORB-011：任务移动）。
 *
 * 与 task.test.ts 同一套基础设施：在独立测试库 orbit_test（TEST_DATABASE_URL）上直接调用
 * Next.js route handler（纯 `(Request, ctx?) => Response`），覆盖真实路由编排
 * （请求 ID → Origin → 会话 → schema → 领域服务 → 信封）而不启 HTTP 服务。
 *
 * ⚠️ 单例隔离（必须在动态 import 前）：
 *  - `vi.mock("@/server/db/prisma")` 把应用 Prisma 单例换成绑定 TEST_DATABASE_URL 的客户端；
 *  - `APP_ENV="test"` 关闭 Better Auth 内置限流；
 *  - 会话夹具用同一个 auth 单例签发 cookie。
 *
 * 覆盖场景（docs/01 §4/§6、docs/04 §3/§4/§5、docs/05 §4/§5/§6）：
 *  合法跨列移动 → 200，task.status/version/boardVersion 变更，ActivityLog TASK_MOVED，响应不含 position /
 *  expectedVersion 不符 → 409 VERSION_CONFLICT + currentVersion /
 *  expectedBoardVersion 不符 → 409 BOARD_CONFLICT + currentBoardVersion /
 *  归档项目移动 → 409 PROJECT_ARCHIVED /
 *  已删除任务移动 → 404 /
 *  非成员移动 → 404 /
 *  并发移动（相同 boardVersion）→ 恰好一个成功，另一个 409 BOARD_CONFLICT /
 *  beforeTaskId 插入到指定任务前 → position 正确 /
 *  beforeTaskId=null 追加列尾 /
 *  进入 DONE 设 completedAt，离开 DONE 清空 /
 *  响应体 JSON 可解析（不含 bigint）。
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
  const testEnv = parseTestEnv(
    process.env as Record<string, string | undefined>,
  );
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
const tasksRoute = await import(
  "@/app/api/v1/projects/[projectId]/tasks/route"
);
const moveRoute = await import("@/app/api/v1/tasks/[taskId]/move/route");
const boardRoute = await import(
  "@/app/api/v1/projects/[projectId]/board/route"
);
const taskRoute = await import("@/app/api/v1/tasks/[taskId]/route");
const { getRateLimiter } = await import("@/server/modules/rate-limit");
const { auth } = await import("@/server/auth");
const { prisma: testPrisma } = await import("@/server/db/prisma");

/* ── 夹具常量 ─────────────────────────────────────────────────────────── */

const RUN_TAG = `orb011-${Date.now()}`;
const domain = "orbit.test";
const EMAIL_A = `${RUN_TAG}-a@${domain}`; // 主账户：项目 owner、任务创建者
const EMAIL_B = `${RUN_TAG}-b@${domain}`; // 成员账户：可移动任务
const EMAIL_C = `${RUN_TAG}-c@${domain}`; // 非成员账户：404
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
const MoveResultSuccess = SuccessResponseSchema(MoveResultSchema);

/* ── 请求辅助 ─────────────────────────────────────────────────────────── */

interface ReqOptions {
  cookie?: string | null;
  body?: unknown;
  origin?: string | null;
  idempotencyKey?: string;
  requestId?: string;
}

function buildRequest(
  method: string,
  url: string,
  options: ReqOptions = {},
): Request {
  const {
    cookie = null,
    body,
    origin = TRUSTED_ORIGIN,
    idempotencyKey,
    requestId,
  } = options;
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
function ctxProject(projectId: string): {
  params: Promise<{ projectId: string }>;
} {
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
  await testPrisma.user.update({
    where: { email },
    data: { emailVerified: true },
  });
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
  await testPrisma.activityLog.deleteMany({
    where: { projectId: { in: projectIds } },
  });
  await testPrisma.idempotencyRecord.deleteMany({
    where: { userId: { in: userIds } },
  });
  await testPrisma.task.deleteMany({
    where: { projectId: { in: projectIds } },
  });
  await testPrisma.projectMember.deleteMany({
    where: { projectId: { in: projectIds } },
  });
  await testPrisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await testPrisma.user.deleteMany({ where: { id: { in: userIds } } });
  await testPrisma.verification.deleteMany({
    where: { identifier: { contains: RUN_TAG } },
  });
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
  const a = await testPrisma.user.findUniqueOrThrow({
    where: { email: EMAIL_A },
  });
  const b = await testPrisma.user.findUniqueOrThrow({
    where: { email: EMAIL_B },
  });
  const c = await testPrisma.user.findUniqueOrThrow({
    where: { email: EMAIL_C },
  });
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
  await testPrisma.activityLog.deleteMany({
    where: { projectId: { in: projectIds } },
  });
  await testPrisma.idempotencyRecord.deleteMany({
    where: { userId: { in: userIds } },
  });
  await testPrisma.task.deleteMany({
    where: { projectId: { in: projectIds } },
  });
  await testPrisma.projectMember.deleteMany({
    where: {
      OR: [{ projectId: { in: projectIds } }, { userId: { in: userIds } }],
    },
  });
  await testPrisma.project.deleteMany({ where: { id: { in: projectIds } } });
});

afterAll(async () => {
  await cleanup();
  await testPrisma.$disconnect();
});

/* ── 领域辅助 ─────────────────────────────────────────────────────────── */

/** POST /projects 创建项目并断言 201，返回 ProjectDTO。 */
async function createProjectOk(
  cookie: string,
  name: string,
): Promise<ProjectDTO> {
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
async function archiveProject(
  cookie: string,
  project: ProjectDTO,
): Promise<void> {
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

/** 查询项目的当前 boardVersion（从 Project 表）。 */
async function getBoardVersion(projectId: string): Promise<number> {
  const p = await testPrisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { boardVersion: true },
  });
  return p.boardVersion;
}

/** 查询项目的当前 archivedAt。 */
async function getArchivedAt(projectId: string): Promise<Date | null> {
  const p = await testPrisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { archivedAt: true },
  });
  return p.archivedAt;
}

/** 查询任务的完整行（包含 position、version、completedAt）。 */
async function getTaskRow(taskId: string) {
  return testPrisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: {
      id: true,
      status: true,
      position: true,
      version: true,
      completedAt: true,
      deletedAt: true,
      projectId: true,
      number: true,
    },
  });
}

/** 查询项目的 ActivityLog（按 createdAt DESC）。 */
async function getActivityLogs(projectId: string) {
  return testPrisma.activityLog.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
}

/* ── 测试用例 ─────────────────────────────────────────────────────────── */

describe("POST /tasks/{taskId}/move（ORB-011：任务移动）", () => {
  /* ── 1. 合法跨列移动：200，status/version/boardVersion 变更，ActivityLog TASK_MOVED，响应不含 position ── */
  it("合法跨列移动 → 200，task.status/version/boardVersion 变更，ActivityLog TASK_MOVED，响应不含 position", async () => {
    // 准备：创建项目、添加成员 B、创建任务
    const project = await createProjectOk(cookieA, "移动项目");
    await addMember(project.id, userBId);
    const { task } = await createTaskOk(cookieA, project.id, {
      title: "移动任务 A",
      status: "TODO",
      priority: "MEDIUM",
    });

    // 执行移动：A 用户把任务从 TODO → IN_PROGRESS（beforeTaskId=null → 追加列尾）
    const boardVersionBefore = await getBoardVersion(project.id);
    const moveResponse = await moveRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task.id}/move`, {
        cookie: cookieA,
        body: {
          expectedVersion: task.version,
          expectedBoardVersion: boardVersionBefore,
          toStatus: "IN_PROGRESS",
          beforeTaskId: null,
        },
      }),
      ctxTask(task.id),
    );

    // 断言：200 OK
    expect(moveResponse.status).toBe(200);
    // 先读取原始文本（body 只能读一次），再从中解析 JSON
    const responseText = await moveResponse.text();
    const moveResult = MoveResultSuccess.parse(
      JSON.parse(responseText) as unknown,
    ).data;

    // 响应形状符合契约：{task, boardVersion}
    expect(moveResult).toHaveProperty("task");
    expect(moveResult).toHaveProperty("boardVersion");

    // task 字段：status 变更，version+1，不含 position
    expect(moveResult.task.status).toBe("IN_PROGRESS");
    expect(moveResult.task.version).toBe(task.version + 1);
    expect(moveResult.task).not.toHaveProperty("position");

    // boardVersion：+1
    expect(moveResult.boardVersion).toBe(boardVersionBefore + 1);

    // 数据库验证：任务行确实更新了
    const taskRow = await getTaskRow(task.id);
    expect(taskRow.status).toBe("IN_PROGRESS");
    expect(taskRow.version).toBe(task.version + 1);
    expect(
      taskRow.position !== null && typeof taskRow.position === "bigint",
    ).toBe(true); // position 存在但不出现在 DTO

    // ActivityLog 验证：有 TASK_MOVED 记录
    const logs = await getActivityLogs(project.id);
    const moveLog = logs.find((l) => l.action === "TASK_MOVED");
    expect(moveLog).toBeDefined();
    expect(moveLog?.entityType).toBe("TASK");
    expect(moveLog?.entityId).toBe(task.id);
    expect(moveLog?.actorId).toBe(userAId);
    expect(moveLog?.metadata).toMatchObject({
      fromStatus: "TODO",
      toStatus: "IN_PROGRESS",
      taskIdentifier: `${project.key}-${task.number}`,
    });

    // 响应体 JSON 可解析（不含 bigint）—— responseText 已在上方读取
    expect(() => JSON.parse(responseText)).not.toThrow();
    expect(responseText).not.toContain("BigInt");
  });

  /* ── 2. expectedVersion 不符 → 409 VERSION_CONFLICT + currentVersion ── */
  it("expectedVersion 不符 → 409 VERSION_CONFLICT + currentVersion", async () => {
    const project = await createProjectOk(cookieA, "版本冲突项目");
    const { task } = await createTaskOk(cookieA, project.id, {
      title: "任务 B",
      status: "TODO",
    });

    // 先成功移动一次（task.version → +1，boardVersion → +1）
    const boardVersion0 = await getBoardVersion(project.id);
    const firstMove = await moveRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task.id}/move`, {
        cookie: cookieA,
        body: {
          expectedVersion: task.version,
          expectedBoardVersion: boardVersion0,
          toStatus: "IN_PROGRESS",
          beforeTaskId: null,
        },
      }),
      ctxTask(task.id),
    );
    expect(firstMove.status).toBe(200);
    const afterFirst = MoveResultSuccess.parse(
      (await firstMove.json()) as unknown,
    ).data;
    const boardVersion1 = await getBoardVersion(project.id);

    // 再用**陈旧的** expectedVersion（task.version，仍 ≥1）移动 → 409 VERSION_CONFLICT
    // boardVersion 传当前正确值，确保冲突来自任务版本而非看板版本（版本检查先于看板检查）
    const conflictResponse = await moveRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task.id}/move`, {
        cookie: cookieA,
        body: {
          expectedVersion: task.version, // 陈旧值（当前应为 afterFirst.task.version）
          expectedBoardVersion: boardVersion1,
          toStatus: "DONE",
          beforeTaskId: null,
        },
      }),
      ctxTask(task.id),
    );

    expect(conflictResponse.status).toBe(409);
    const errorBody = await readError(conflictResponse);
    expect(errorBody.error.code).toBe("VERSION_CONFLICT");
    expect(errorBody.error.currentVersion).toBe(afterFirst.task.version);

    // 数据库验证：任务未变化（仍为 IN_PROGRESS，version 未再 +1）
    const taskRow = await getTaskRow(task.id);
    expect(taskRow.status).toBe("IN_PROGRESS");
    expect(taskRow.version).toBe(afterFirst.task.version);
  });

  /* ── 3. expectedBoardVersion 不符 → 409 BOARD_CONFLICT + currentBoardVersion ── */
  it("expectedBoardVersion 不符 → 409 BOARD_CONFLICT + currentBoardVersion", async () => {
    const project = await createProjectOk(cookieA, "看板冲突项目");
    const { task } = await createTaskOk(cookieA, project.id, {
      title: "任务 C",
      status: "TODO",
    });

    // 先移动一次任务（boardVersion+1），再用旧的 expectedBoardVersion 移动 → 冲突
    const boardVersion = await getBoardVersion(project.id);
    await moveRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task.id}/move`, {
        cookie: cookieA,
        body: {
          expectedVersion: task.version,
          expectedBoardVersion: boardVersion,
          toStatus: "IN_PROGRESS",
          beforeTaskId: null,
        },
      }),
      ctxTask(task.id),
    );

    const newBoardVersion = await getBoardVersion(project.id);
    const taskRowAfterFirst = await getTaskRow(task.id);

    // 第二次移动，用旧的 boardVersion → 冲突
    const conflictResponse = await moveRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task.id}/move`, {
        cookie: cookieA,
        body: {
          expectedVersion: taskRowAfterFirst.version,
          expectedBoardVersion: boardVersion, // 旧值
          toStatus: "DONE",
          beforeTaskId: null,
        },
      }),
      ctxTask(task.id),
    );

    expect(conflictResponse.status).toBe(409);
    const errorBody = await readError(conflictResponse);
    expect(errorBody.error.code).toBe("BOARD_CONFLICT");
    expect(errorBody.error.currentBoardVersion).toBe(newBoardVersion);

    // 数据库验证：任务未变化
    const taskRowFinal = await getTaskRow(task.id);
    expect(taskRowFinal.status).toBe("IN_PROGRESS");
  });

  /* ── 4. 归档项目移动 → 409 PROJECT_ARCHIVED，无变化 ── */
  it("归档项目移动 → 409 PROJECT_ARCHIVED，无变化", async () => {
    const project = await createProjectOk(cookieA, "归档项目");
    const { task } = await createTaskOk(cookieA, project.id, {
      title: "任务 D",
      status: "TODO",
    });

    // 归档项目
    await archiveProject(cookieA, project);
    const archivedAt = await getArchivedAt(project.id);
    expect(archivedAt).not.toBeNull();

    // 尝试移动归档项目的任务 → 409
    const boardVersion = await getBoardVersion(project.id);
    const archivedResponse = await moveRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task.id}/move`, {
        cookie: cookieA,
        body: {
          expectedVersion: task.version,
          expectedBoardVersion: boardVersion,
          toStatus: "DONE",
          beforeTaskId: null,
        },
      }),
      ctxTask(task.id),
    );

    expect(archivedResponse.status).toBe(409);
    const errorBody = await readError(archivedResponse);
    expect(errorBody.error.code).toBe("PROJECT_ARCHIVED");

    // 数据库验证：任务未变化
    const taskRow = await getTaskRow(task.id);
    expect(taskRow.status).toBe("TODO");
  });

  /* ── 5. 已删除任务移动 → 404 ── */
  it("已删除任务移动 → 404", async () => {
    const project = await createProjectOk(cookieA, "删除任务项目");
    const { task } = await createTaskOk(cookieA, project.id, {
      title: "任务 E",
      status: "TODO",
    });

    // 软删除任务
    await testPrisma.task.update({
      where: { id: task.id },
      data: { deletedAt: new Date() },
    });

    // 尝试移动已删除任务 → 404
    const boardVersion = await getBoardVersion(project.id);
    const deletedResponse = await moveRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task.id}/move`, {
        cookie: cookieA,
        body: {
          expectedVersion: task.version,
          expectedBoardVersion: boardVersion,
          toStatus: "DONE",
          beforeTaskId: null,
        },
      }),
      ctxTask(task.id),
    );

    expect(deletedResponse.status).toBe(404);
    const errorBody = await readError(deletedResponse);
    expect(errorBody.error.code).toBe("NOT_FOUND");
  });

  /* ── 6. 非成员移动 → 404 ── */
  it("非成员移动 → 404", async () => {
    const project = await createProjectOk(cookieA, "非成员项目");
    const { task } = await createTaskOk(cookieA, project.id, {
      title: "任务 F",
      status: "TODO",
    });

    // C 不是成员，尝试移动 → 404（不泄露项目是否存在）
    const boardVersion = await getBoardVersion(project.id);
    const nonMemberResponse = await moveRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task.id}/move`, {
        cookie: cookieC,
        body: {
          expectedVersion: task.version,
          expectedBoardVersion: boardVersion,
          toStatus: "DONE",
          beforeTaskId: null,
        },
      }),
      ctxTask(task.id),
    );

    expect(nonMemberResponse.status).toBe(404);
    const errorBody = await readError(nonMemberResponse);
    expect(errorBody.error.code).toBe("NOT_FOUND");
  });

  /* ── 7. 并发移动：两个请求用相同 expectedBoardVersion 并发移动同项目两个不同任务 → 恰好一个成功，另一个 409 BOARD_CONFLICT ── */
  it("并发移动（相同 boardVersion）→ 恰好一个成功，另一个 409 BOARD_CONFLICT", async () => {
    const project = await createProjectOk(cookieA, "并发项目");
    await addMember(project.id, userBId);

    // 创建两个任务
    const { task: task1 } = await createTaskOk(cookieA, project.id, {
      title: "并发任务 1",
      status: "TODO",
    });
    const { task: task2 } = await createTaskOk(cookieB, project.id, {
      title: "并发任务 2",
      status: "TODO",
    });

    const boardVersion = await getBoardVersion(project.id);

    // 并发发起两个移动请求（相同 expectedBoardVersion）
    const [response1, response2] = await Promise.all([
      moveRoute.POST(
        buildRequest("POST", `${BASE}/tasks/${task1.id}/move`, {
          cookie: cookieA,
          body: {
            expectedVersion: task1.version,
            expectedBoardVersion: boardVersion,
            toStatus: "IN_PROGRESS",
            beforeTaskId: null,
          },
        }),
        ctxTask(task1.id),
      ),
      moveRoute.POST(
        buildRequest("POST", `${BASE}/tasks/${task2.id}/move`, {
          cookie: cookieB,
          body: {
            expectedVersion: task2.version,
            expectedBoardVersion: boardVersion,
            toStatus: "DONE",
            beforeTaskId: null,
          },
        }),
        ctxTask(task2.id),
      ),
    ]);

    // 断言：恰好一个成功，一个冲突
    const statuses = [response1.status, response2.status].sort();
    expect(statuses).toEqual([200, 409]);

    // 找出成功和失败的响应
    const successResponse = response1.status === 200 ? response1 : response2;
    const conflictResponse = response1.status === 409 ? response1 : response2;

    // 成功的响应：200，boardVersion+1
    expect(successResponse.status).toBe(200);
    const successResult = MoveResultSuccess.parse(
      (await successResponse.json()) as unknown,
    ).data;
    expect(successResult.boardVersion).toBe(boardVersion + 1);

    // 失败的响应：409 BOARD_CONFLICT，currentBoardVersion=boardVersion+1
    expect(conflictResponse.status).toBe(409);
    const errorBody = await readError(conflictResponse);
    expect(errorBody.error.code).toBe("BOARD_CONFLICT");
    expect(errorBody.error.currentBoardVersion).toBe(boardVersion + 1);

    // 数据库验证：只有一个任务被移动了
    const task1Row = await getTaskRow(task1.id);
    const task2Row = await getTaskRow(task2.id);
    const movedCount = [
      task1Row.status !== "TODO",
      task2Row.status !== "TODO",
    ].filter(Boolean).length;
    expect(movedCount).toBe(1);
  });

  /* ── 8. beforeTaskId 插入到指定任务前 → position 正确 ── */
  it("beforeTaskId 插入到指定任务前 → position 正确", async () => {
    const project = await createProjectOk(cookieA, "插入项目");

    // 创建三个任务，初始位置：1024, 2048, 3072
    const { task: task1 } = await createTaskOk(cookieA, project.id, {
      title: "任务 1",
      status: "TODO",
    });
    const { task: task2 } = await createTaskOk(cookieA, project.id, {
      title: "任务 2",
      status: "TODO",
    });
    const { task: task3 } = await createTaskOk(cookieA, project.id, {
      title: "任务 3",
      status: "TODO",
    });

    // 将 task1 插入到 task3 之前（目标列 TODO，beforeTaskId=task3.id）
    // task1 当前位置=1024，task2=2048，task3=3072
    // 插入后：task1 应在 task2 和 task3 之间，position≈2560（中点）
    const boardVersion = await getBoardVersion(project.id);
    const insertResponse = await moveRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task1.id}/move`, {
        cookie: cookieA,
        body: {
          expectedVersion: task1.version,
          expectedBoardVersion: boardVersion,
          toStatus: "TODO", // 同列重排
          beforeTaskId: task3.id,
        },
      }),
      ctxTask(task1.id),
    );

    expect(insertResponse.status).toBe(200);
    const result = MoveResultSuccess.parse(
      (await insertResponse.json()) as unknown,
    ).data;

    // 验证 position 在 task2 和 task3 之间
    const task1Row = await getTaskRow(task1.id);
    const task2Row = await getTaskRow(task2.id);
    const task3Row = await getTaskRow(task3.id);

    expect(Number(task1Row.position)).toBeGreaterThan(
      Number(task2Row.position),
    );
    expect(Number(task1Row.position)).toBeLessThan(Number(task3Row.position));

    // 验证 status 未变（同列重排）
    expect(result.task.status).toBe("TODO");
  });

  /* ── 9. beforeTaskId=null 追加列尾 ── */
  it("beforeTaskId=null 追加列尾", async () => {
    const project = await createProjectOk(cookieA, "追加项目");

    // 创建两个任务在 TODO 列（task2 仅用于填充列，不参与移动断言）
    const { task: task1 } = await createTaskOk(cookieA, project.id, {
      title: "任务 1",
      status: "TODO",
    });
    await createTaskOk(cookieA, project.id, {
      title: "任务 2",
      status: "TODO",
    });

    // 将 task1 移动到 IN_PROGRESS 列尾（beforeTaskId=null）
    const boardVersion = await getBoardVersion(project.id);
    const appendResponse = await moveRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task1.id}/move`, {
        cookie: cookieA,
        body: {
          expectedVersion: task1.version,
          expectedBoardVersion: boardVersion,
          toStatus: "IN_PROGRESS",
          beforeTaskId: null,
        },
      }),
      ctxTask(task1.id),
    );

    expect(appendResponse.status).toBe(200);

    // 验证 task1 在 IN_PROGRESS 列，position 是该列最大值+GAP
    const task1Row = await getTaskRow(task1.id);
    expect(task1Row.status).toBe("IN_PROGRESS");

    // 查询 IN_PROGRESS 列所有任务，验证 task1 在最后
    const inProgressTasks = await testPrisma.task.findMany({
      where: { projectId: project.id, status: "IN_PROGRESS", deletedAt: null },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    expect(inProgressTasks[inProgressTasks.length - 1]?.id).toBe(task1.id);
  });

  /* ── 10. 进入 DONE 设 completedAt，离开 DONE 清空 ── */
  it("进入 DONE 设 completedAt，离开 DONE 清空", async () => {
    const project = await createProjectOk(cookieA, "完成时间项目");
    const { task } = await createTaskOk(cookieA, project.id, {
      title: "任务 G",
      status: "TODO",
    });

    // 第一次移动：TODO → DONE，应设置 completedAt
    const boardVersion1 = await getBoardVersion(project.id);
    const doneResponse = await moveRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task.id}/move`, {
        cookie: cookieA,
        body: {
          expectedVersion: task.version,
          expectedBoardVersion: boardVersion1,
          toStatus: "DONE",
          beforeTaskId: null,
        },
      }),
      ctxTask(task.id),
    );

    expect(doneResponse.status).toBe(200);
    const doneResult = MoveResultSuccess.parse(
      (await doneResponse.json()) as unknown,
    ).data;
    expect(doneResult.task.completedAt).not.toBeNull();

    const taskRowAfterDone = await getTaskRow(task.id);
    expect(taskRowAfterDone.completedAt).not.toBeNull();

    // 第二次移动：DONE → IN_PROGRESS，应清空 completedAt
    const boardVersion2 = await getBoardVersion(project.id);
    const leaveDoneResponse = await moveRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task.id}/move`, {
        cookie: cookieA,
        body: {
          expectedVersion: doneResult.task.version,
          expectedBoardVersion: boardVersion2,
          toStatus: "IN_PROGRESS",
          beforeTaskId: null,
        },
      }),
      ctxTask(task.id),
    );

    expect(leaveDoneResponse.status).toBe(200);
    const leaveResult = MoveResultSuccess.parse(
      (await leaveDoneResponse.json()) as unknown,
    ).data;
    expect(leaveResult.task.completedAt).toBeNull();

    const taskRowFinal = await getTaskRow(task.id);
    expect(taskRowFinal.completedAt).toBeNull();
  });

  /* ── 11. 响应体 JSON 可解析（不含 bigint）── */
  it("响应体 JSON 可解析（不含 bigint）", async () => {
    const project = await createProjectOk(cookieA, "JSON 项目");
    const { task } = await createTaskOk(cookieA, project.id, {
      title: "任务 H",
      status: "TODO",
    });

    const boardVersion = await getBoardVersion(project.id);
    const moveResponse = await moveRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${task.id}/move`, {
        cookie: cookieA,
        body: {
          expectedVersion: task.version,
          expectedBoardVersion: boardVersion,
          toStatus: "IN_PROGRESS",
          beforeTaskId: null,
        },
      }),
      ctxTask(task.id),
    );

    expect(moveResponse.status).toBe(200);

    // 获取原始响应文本
    const responseText = await moveResponse.text();

    // 验证 JSON 可解析
    expect(() => JSON.parse(responseText)).not.toThrow();

    // 验证响应体不含 "BigInt" 字符串（JSON.stringify(bigint) 会抛错或输出特殊格式）
    expect(responseText).not.toContain("BigInt");
    expect(responseText).not.toContain("bigint");

    // 验证响应体不含 position 字段
    expect(responseText).not.toContain('"position"');

    // 验证契约 schema 校验通过
    const parsed = MoveResultSuccess.parse(JSON.parse(responseText));
    expect(parsed.data.task).not.toHaveProperty("position");
  });
});

describe("M3 readiness regressions", () => {
  async function boardResponse(
    projectId: string,
    query = "",
    cookie = cookieA,
  ) {
    return boardRoute.GET(
      buildRequest("GET", BASE + "/projects/" + projectId + "/board" + query, {
        cookie,
      }),
      ctxProject(projectId),
    );
  }
  async function board(projectId: string, query = "") {
    const response = await boardResponse(projectId, query);
    expect(response.status).toBe(200);
    return SuccessResponseSchema(BoardSchema).parse(await response.json()).data;
  }
  it("reads ordered columns and totals, continues a bound cursor and rejects stale snapshots", async () => {
    const p = await createProjectOk(cookieA, "Board snapshot");
    for (const title of ["A", "B", "C"])
      await createTaskOk(cookieA, p.id, { title });
    const first = await board(p.id, "?limit=2");
    const column = first.columns[0]!;
    expect(column.items.map((t) => t.title)).toEqual(["A", "B"]);
    expect(column.total).toBe(3);
    expect(column.nextCursor).not.toBeNull();
    const query =
      "?limit=2&status=TODO&cursor=" + encodeURIComponent(column.nextCursor!);
    const next = await board(p.id, query);
    expect(next.columns).toHaveLength(1);
    expect(next.columns[0]!.items.map((t) => t.title)).toEqual(["C"]);
    expect(next.columns[0]!.total).toBe(3);
    expect(next.columns[0]!.nextCursor).toBeNull();
    expect((await boardResponse(p.id, query + "&q=other")).status).toBe(400);
    expect(
      (
        await boardResponse(
          p.id,
          "?cursor=" + encodeURIComponent(column.nextCursor!),
        )
      ).status,
    ).toBe(400);
    await createTaskOk(cookieA, p.id, { title: "D" });
    const stale = await boardResponse(p.id, query);
    expect(stale.status).toBe(409);
    expect((await readError(stale)).error.code).toBe("BOARD_CONFLICT");
  });
  it("keeps archived boards readable and denies outsiders", async () => {
    const p = await createProjectOk(cookieA, "Read only board");
    await createTaskOk(cookieA, p.id, { title: "History" });
    await archiveProject(cookieA, p);
    expect((await board(p.id)).columns[0]!.items[0]!.title).toBe("History");
    expect((await boardResponse(p.id, "", cookieC)).status).toBe(404);
    expect((await boardResponse("not-a-uuid")).status).toBe(404);
  });
  it("filters by identifier and rejects mismatched filters and malformed cursor values", async () => {
    const p = await createProjectOk(cookieA, "Board filters");
    const { task } = await createTaskOk(cookieA, p.id, {
      title: "Title",
      priority: "HIGH",
    });
    expect((await board(p.id, "?q=" + task.identifier)).columns[0]!.total).toBe(
      1,
    );
    expect((await board(p.id, "?priority=LOW")).columns[0]!.total).toBe(0);
    expect(
      (await boardResponse(p.id, "?assigneeId=" + userAId + "&unassigned=true"))
        .status,
    ).toBe(400);
    expect(
      (await boardResponse(p.id, "?status=TODO&cursor=broken")).status,
    ).toBe(400);
  });
  it("treats an already-last task as no-op without versions or activity changes, but rejects self targets", async () => {
    const p = await createProjectOk(cookieA, "No-op tail");
    await createTaskOk(cookieA, p.id, { title: "A" });
    const { task } = await createTaskOk(cookieA, p.id, { title: "B" });
    const version = await getBoardVersion(p.id);
    const count = await testPrisma.activityLog.count({
      where: { projectId: p.id },
    });
    const body = {
      expectedVersion: task.version,
      expectedBoardVersion: version,
      toStatus: "TODO",
      beforeTaskId: null,
    };
    const response = await moveRoute.POST(
      buildRequest("POST", BASE + "/tasks/" + task.id + "/move", {
        cookie: cookieA,
        body,
      }),
      ctxTask(task.id),
    );
    const result = MoveResultSuccess.parse(await response.json()).data;
    expect(result.task.version).toBe(task.version);
    expect(result.boardVersion).toBe(version);
    expect(
      await testPrisma.activityLog.count({ where: { projectId: p.id } }),
    ).toBe(count);
    const self = await moveRoute.POST(
      buildRequest("POST", BASE + "/tasks/" + task.id + "/move", {
        cookie: cookieA,
        body: { ...body, beforeTaskId: task.id },
      }),
      ctxTask(task.id),
    );
    expect(self.status).toBe(422);
  });
  it("replays the same task creation through equivalent UUID casing", async () => {
    const p = await createProjectOk(cookieA, "UUID replay");
    const key = randomUUID();
    const body = { title: "One creation" };
    await createTaskOk(cookieA, p.id.toUpperCase(), body, key);
    const replay = await tasksRoute.POST(
      buildRequest("POST", BASE + "/projects/" + p.id + "/tasks", {
        cookie: cookieA,
        body,
        idempotencyKey: key,
      }),
      ctxProject(p.id),
    );
    expect(replay.status).toBe(200);
    expect(await testPrisma.task.count({ where: { projectId: p.id } })).toBe(1);
  });
  it("shares the write quota across task creation, editing, project creation and move", async () => {
    const p = await createProjectOk(cookieA, "Shared limit");
    const { task } = await createTaskOk(cookieA, p.id, { title: "Quota" });
    const limiter = await getRateLimiter();
    await limiter.clearAll();
    for (let i = 0; i < 60; i++)
      expect((await limiter.checkLimit(userAId, "write")).allowed).toBe(true);
    const calls = [
      tasksRoute.POST(
        buildRequest("POST", BASE + "/projects/" + p.id + "/tasks", {
          cookie: cookieA,
          body: { title: "Blocked" },
          idempotencyKey: randomUUID(),
        }),
        ctxProject(p.id),
      ),
      taskRoute.PATCH(
        buildRequest("PATCH", BASE + "/tasks/" + task.id, {
          cookie: cookieA,
          body: { title: "Blocked", expectedVersion: 1 },
        }),
        ctxTask(task.id),
      ),
      projectsRoute.POST(
        buildRequest("POST", BASE + "/projects", {
          cookie: cookieA,
          body: { name: "Blocked", key: nextKey() },
          idempotencyKey: randomUUID(),
        }),
      ),
      moveRoute.POST(
        buildRequest("POST", BASE + "/tasks/" + task.id + "/move", {
          cookie: cookieA,
          body: {
            expectedVersion: 1,
            expectedBoardVersion: 2,
            toStatus: "DONE",
            beforeTaskId: null,
          },
        }),
        ctxTask(task.id),
      ),
    ];
    for (const response of await Promise.all(calls)) {
      expect(response.status).toBe(429);
      expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    }
    expect((await limiter.checkLimit(userBId, "write")).allowed).toBe(true);
  });
  it("retries a real PostgreSQL lock timeout and succeeds when the lock is released", async () => {
    const p = await createProjectOk(cookieA, "Short lock");
    let acquired = () => {};
    const ready = new Promise<void>((r) => {
      acquired = r;
    });
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const held = testPrisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT id FROM "Project" WHERE id=$1::uuid FOR UPDATE',
          p.id,
        );
        acquired();
        await gate;
      },
      { timeout: 15000 },
    );
    await ready;
    const timer = setTimeout(release, 3500);
    try {
      await createTaskOk(cookieA, p.id, { title: "Retried" });
    } finally {
      clearTimeout(timer);
      release();
      await held;
    }
  }, 20000);
  it("maps exhausted lock retries to LOCKED without creating a task", async () => {
    const p = await createProjectOk(cookieA, "Long lock");
    let acquired = () => {};
    const ready = new Promise<void>((r) => {
      acquired = r;
    });
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const held = testPrisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT id FROM "Project" WHERE id=$1::uuid FOR UPDATE',
          p.id,
        );
        acquired();
        await gate;
      },
      { timeout: 25000 },
    );
    await ready;
    try {
      const response = await tasksRoute.POST(
        buildRequest("POST", BASE + "/projects/" + p.id + "/tasks", {
          cookie: cookieA,
          body: { title: "Blocked" },
          idempotencyKey: randomUUID(),
        }),
        ctxProject(p.id),
      );
      expect(response.status).toBe(409);
      expect((await readError(response)).error.code).toBe("LOCKED");
    } finally {
      release();
      await held;
    }
    expect(await testPrisma.task.count({ where: { projectId: p.id } })).toBe(0);
  }, 30000);
});
