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
 * 跨项目资源归属**显式**集成测试（M4 收尾工作项 4b / 缺口 1）。
 *
 * 背景：既有 task.test.ts / permission.test.ts 已覆盖「非成员访问本项目资源 → 404」与
 * 「已移除用户 → 404」，但没有**显式**构造「资源属于 project A，用 project B 的成员/owner
 * 身份仅凭资源 ID 去访问」的跨项目归属用例。本文件补齐这一显式缺口。
 *
 * 关键不变量（docs/03 §5、docs/05 §3）：**非成员与「不存在」同形** —— 一切非本项目成员
 * （含另一个项目的 owner、完全无关的第三方、本项目已移除的前成员）通过 taskId 访问该任务，
 * 必须统一收敛为 **404 NOT_FOUND**（绝不 403），以不泄露「该任务是否存在」这一信息。
 * 授权入口是领域服务的 `requireProjectMember(task.projectId, userId)`：它只认「任务所属项目」
 * 的成员关系，与请求者在别的项目里的角色（哪怕是 owner）完全无关。
 *
 * 夹具拓扑：
 *  - project A：owner = userA，成员 = userA2（对照：应能访问 T → 200）；
 *  - project B：owner = userB（userB 是 B 的 owner，但不是 A 的成员）；
 *  - task T：属于 project A，由 userA 创建；
 *  - userC：两个项目都不是成员（完全无关第三方）；
 *  - userR：曾是 A 的成员，随后被移除（已移除前成员）。
 *
 * ⚠️ 单例隔离（必须在动态 import 前）：vi.mock 绑定 TEST_DATABASE_URL + APP_ENV=test 关闭限流。
 * ⚠️ 精确清理：唯一 RUN_TAG/邮箱，afterAll 按自身夹具 子→父 顺序删除，绝不触碰 orbit_dev、不清空库。
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

const RUN_TAG = `orbxproj-${Date.now()}`;
const domain = "orbit.test";
const EMAIL_A = `${RUN_TAG}-a@${domain}`; // project A 的 owner，T 的创建者
const EMAIL_A2 = `${RUN_TAG}-a2@${domain}`; // project A 的成员（对照：应 200）
const EMAIL_B = `${RUN_TAG}-b@${domain}`; // project B 的 owner，A 的非成员
const EMAIL_C = `${RUN_TAG}-c@${domain}`; // 完全无关第三方（两项目都非成员）
const EMAIL_R = `${RUN_TAG}-r@${domain}`; // 曾是 A 的成员，随后被移除
const PASSWORD = "Str0ng!Passw0rd-OrbitTest";

const BASE = `${env.BETTER_AUTH_URL}/api/v1`;
const TRUSTED_ORIGIN =
  env.AUTH_TRUSTED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0] ?? env.BETTER_AUTH_URL;

/** key 前缀：run 唯一，确保跨运行不撞 DB 全局唯一约束。 */
const KEY_PREFIX = `X${Date.now().toString(36).slice(-4).toUpperCase()}`;
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
let cookieA2 = "";
let cookieB = "";
let cookieC = "";
let cookieR = "";
let userAId = "";
let userA2Id = "";
let userBId = "";
let userCId = "";
let userRId = "";

/** 本 run 创建的全部用户邮箱（清理时按其反查 userId）。 */
const ALL_EMAILS = [EMAIL_A, EMAIL_A2, EMAIL_B, EMAIL_C, EMAIL_R];

/** 清理本 run 数据（FK onDelete: Restrict，须按 子→父 顺序删除）。 */
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
  await testPrisma.verification.deleteMany({
    where: { identifier: { in: ALL_EMAILS } },
  });
}

beforeAll(async () => {
  await cleanup();
  await signUpVerified(EMAIL_A, "项目A主");
  await signUpVerified(EMAIL_A2, "项目A成员");
  await signUpVerified(EMAIL_B, "项目B主");
  await signUpVerified(EMAIL_C, "无关第三方");
  await signUpVerified(EMAIL_R, "被移除前成员");
  cookieA = await signIn(EMAIL_A);
  cookieA2 = await signIn(EMAIL_A2);
  cookieB = await signIn(EMAIL_B);
  cookieC = await signIn(EMAIL_C);
  cookieR = await signIn(EMAIL_R);
  for (const [label, cookie] of [
    ["A", cookieA],
    ["A2", cookieA2],
    ["B", cookieB],
    ["C", cookieC],
    ["R", cookieR],
  ] as const) {
    expect(cookie, `${label} 的会话 cookie 应含 session_token`).toContain("session_token");
  }
  const rows = await testPrisma.user.findMany({
    where: { email: { in: ALL_EMAILS } },
    select: { id: true, email: true },
  });
  const byEmail = new Map(rows.map((r) => [r.email, r.id]));
  userAId = byEmail.get(EMAIL_A) ?? "";
  userA2Id = byEmail.get(EMAIL_A2) ?? "";
  userBId = byEmail.get(EMAIL_B) ?? "";
  userCId = byEmail.get(EMAIL_C) ?? "";
  userRId = byEmail.get(EMAIL_R) ?? "";
}, 180_000);

afterEach(async () => {
  // 用例之间不销毁用户（跨用例复用会话），只回收项目/任务/成员等业务数据。
  const userIds = [userAId, userA2Id, userBId, userCId, userRId].filter((id) => id.length > 0);
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

/** 指定用户创建项目并断言 201。 */
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

/** 指定用户在项目内创建任务并断言 201。 */
async function createTaskOk(
  cookie: string,
  projectId: string,
  title: string,
): Promise<TaskDTO> {
  const response = await tasksRoute.POST(
    buildRequest("POST", `${BASE}/projects/${projectId}/tasks`, {
      cookie,
      body: { title },
      idempotencyKey: randomUUID(),
    }),
    ctxProject(projectId),
  );
  expect(response.status).toBe(201);
  return TaskSuccess.parse((await response.json()) as unknown).data;
}

/**
 * 搭建跨项目归属夹具：
 *  - project A（owner = userA），把 userA2 加为成员、userR 加入后再移除；
 *  - project B（owner = userB）；
 *  - task T 属于 project A，由 userA 创建。
 */
async function setupCrossProjectFixture(): Promise<{
  projectA: ProjectDTO;
  projectB: ProjectDTO;
  taskT: TaskDTO;
}> {
  const projectA = await createProjectOk(cookieA, "跨项目归属-A");
  const projectB = await createProjectOk(cookieB, "跨项目归属-B");

  // userA2 是 A 的成员（对照，应可访问 T）。
  await testPrisma.projectMember.create({ data: { projectId: projectA.id, userId: userA2Id } });
  // userR 曾是 A 的成员，随后被移除（模拟「已移除前成员」）。
  await testPrisma.projectMember.create({ data: { projectId: projectA.id, userId: userRId } });
  await testPrisma.projectMember.deleteMany({
    where: { projectId: projectA.id, userId: userRId },
  });
  expect(
    await testPrisma.projectMember.count({ where: { projectId: projectA.id, userId: userRId } }),
  ).toBe(0);

  const taskT = await createTaskOk(cookieA, projectA.id, "属于项目A的任务T");
  return { projectA, projectB, taskT };
}

/* ── 1. 对照：A 的成员可访问 T（证明夹具与授权入口真实生效）────────────── */

describe("跨项目归属对照：项目A的成员可访问任务T（授权入口真实生效）", () => {
  it("userA2（A 的成员）GET /tasks/{T} → 200，且能读到 T", async () => {
    const { taskT } = await setupCrossProjectFixture();

    const res = await taskRoute.GET(
      buildRequest("GET", `${BASE}/tasks/${taskT.id}`, { cookie: cookieA2 }),
      ctxTask(taskT.id),
    );
    expect(res.status).toBe(200);
    const data = TaskSuccess.parse((await res.json()) as unknown).data;
    expect(data.id).toBe(taskT.id);
    expect(data.title).toBe("属于项目A的任务T");
  });
});

/* ── 2. project B 的 owner 仅凭 taskId 访问 A 的任务 → 404 ─────────────── */

describe("跨项目归属：project B 的 owner（非 A 成员）凭 taskId 访问 A 的任务 → 一律 404", () => {
  it("userB GET/PATCH/DELETE /tasks/{T}、restore → 全部 404（不因 B 的 owner 身份放行）", async () => {
    const { taskT } = await setupCrossProjectFixture();

    // GET /tasks/{T}
    await expectNotFound(
      await taskRoute.GET(
        buildRequest("GET", `${BASE}/tasks/${taskT.id}`, { cookie: cookieB }),
        ctxTask(taskT.id),
      ),
    );

    // PATCH /tasks/{T}
    await expectNotFound(
      await taskRoute.PATCH(
        buildRequest("PATCH", `${BASE}/tasks/${taskT.id}`, {
          cookie: cookieB,
          body: { expectedVersion: taskT.version, title: "B 越权改 A 的任务" },
        }),
        ctxTask(taskT.id),
      ),
    );

    // DELETE /tasks/{T}
    await expectNotFound(
      await taskRoute.DELETE(
        buildRequest("DELETE", `${BASE}/tasks/${taskT.id}?expectedVersion=${taskT.version}`, {
          cookie: cookieB,
        }),
        ctxTask(taskT.id),
      ),
    );

    // POST /tasks/{T}/restore
    await expectNotFound(
      await restoreRoute.POST(
        buildRequest("POST", `${BASE}/tasks/${taskT.id}/restore`, {
          cookie: cookieB,
          body: { expectedVersion: taskT.version },
          idempotencyKey: randomUUID(),
        }),
        ctxTask(taskT.id),
      ),
    );

    // 佐证：T 未被越权改动（version 未变、未软删除），确实仍存在。
    const row = await testPrisma.task.findUniqueOrThrow({ where: { id: taskT.id } });
    expect(row.version).toBe(taskT.version);
    expect(row.deletedAt).toBeNull();
  });

  it("userB 访问 project A 本身及其成员/任务列表 → 全部 404（B 的 owner 身份对 A 无效）", async () => {
    const { projectA } = await setupCrossProjectFixture();

    // GET /projects/{A}
    await expectNotFound(
      await projectRoute.GET(
        buildRequest("GET", `${BASE}/projects/${projectA.id}`, { cookie: cookieB }),
        ctxProject(projectA.id),
      ),
    );

    // GET /projects/{A}/members
    await expectNotFound(
      await membersRoute.GET(
        buildRequest("GET", `${BASE}/projects/${projectA.id}/members`, { cookie: cookieB }),
        ctxProject(projectA.id),
      ),
    );

    // GET /projects/{A}/tasks
    await expectNotFound(
      await tasksRoute.GET(
        buildRequest("GET", `${BASE}/projects/${projectA.id}/tasks`, { cookie: cookieB }),
        ctxProject(projectA.id),
      ),
    );

    // POST /projects/{A}/tasks（在别人的项目里建任务）
    await expectNotFound(
      await tasksRoute.POST(
        buildRequest("POST", `${BASE}/projects/${projectA.id}/tasks`, {
          cookie: cookieB,
          body: { title: "B 越权在 A 建任务" },
          idempotencyKey: randomUUID(),
        }),
        ctxProject(projectA.id),
      ),
    );
  });

  it("对照：userB 可正常访问自己 owner 的 project B（证明 404 是归属判定而非全局拒绝）", async () => {
    const { projectB } = await setupCrossProjectFixture();

    const res = await projectRoute.GET(
      buildRequest("GET", `${BASE}/projects/${projectB.id}`, { cookie: cookieB }),
      ctxProject(projectB.id),
    );
    expect(res.status).toBe(200);
    expect(ProjectSuccess.parse((await res.json()) as unknown).data.id).toBe(projectB.id);
  });
});

/* ── 3. 完全无关第三方 userC 访问 T → 404 ──────────────────────────────── */

describe("跨项目归属：完全无关第三方（两项目都非成员）凭 taskId 访问 T → 404", () => {
  it("userC GET/PATCH /tasks/{T} → 全部 404", async () => {
    const { taskT } = await setupCrossProjectFixture();

    await expectNotFound(
      await taskRoute.GET(
        buildRequest("GET", `${BASE}/tasks/${taskT.id}`, { cookie: cookieC }),
        ctxTask(taskT.id),
      ),
    );

    await expectNotFound(
      await taskRoute.PATCH(
        buildRequest("PATCH", `${BASE}/tasks/${taskT.id}`, {
          cookie: cookieC,
          body: { expectedVersion: taskT.version, title: "C 越权改任务" },
        }),
        ctxTask(taskT.id),
      ),
    );
  });
});

/* ── 4. A 的已移除前成员 userR 访问 T → 404 ────────────────────────────── */

describe("跨项目归属：A 的已移除前成员凭 taskId 访问 T → 404", () => {
  it("userR GET/PATCH /tasks/{T} → 全部 404（成员关系被撤销后收敛为不存在）", async () => {
    const { taskT } = await setupCrossProjectFixture();

    await expectNotFound(
      await taskRoute.GET(
        buildRequest("GET", `${BASE}/tasks/${taskT.id}`, { cookie: cookieR }),
        ctxTask(taskT.id),
      ),
    );

    await expectNotFound(
      await taskRoute.PATCH(
        buildRequest("PATCH", `${BASE}/tasks/${taskT.id}`, {
          cookie: cookieR,
          body: { expectedVersion: taskT.version, title: "R 越权改任务" },
        }),
        ctxTask(taskT.id),
      ),
    );
  });
});
