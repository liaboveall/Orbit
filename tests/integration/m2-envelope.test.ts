import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DeletedTaskSchema,
  ErrorResponseSchema,
  ListResponseSchema,
  MemberSchema,
  ProjectSchema,
  SuccessResponseSchema,
  TaskSchema,
  TaskSummarySchema,
  type ProjectDTO,
  type TaskDTO,
} from "@/contracts";
import { getEnv, parseEnv } from "@/server/env";
import { REQUEST_ID_HEADER } from "@/server/http/request-id";

/**
 * M2 Phase 7 / ORB-009：纵向闭环集成验证 — 信封与契约层（m2-envelope）。
 *
 * 采用与 integration 测试相同的 vi.mock 绑定独立库（orbit_test）模式，但**聚焦信封结构验证**：
 *  - GET /projects → {data: Project[], meta: PageMeta{requestId, nextCursor(可空), hasMore}} + Cache-Control + x-request-id；
 *  - POST /projects → {data: Project, meta:{requestId}}；幂等重放返回同一数据；
 *  - GET /projects/{id}/tasks → {data: TaskSummary[], meta}；POST /projects/{id}/tasks → {data: Task, meta}；
 *  - PATCH /tasks/{id} expectedVersion 不符 → 409 VERSION_CONFLICT + meta.requestId + currentVersion；
 *  - DELETE /tasks/{id}?expectedVersion=X → 200 DeletedTask；
 *  - 非成员/不存在项目 → 404 NOT_FOUND；
 *  - 所有响应 Cache-Control: private, no-store；header「x-request-id」== response.meta.requestId；
 *  - DTO 形状断言：**不**含内部字段（TaskDTO.position；ProjectDTO.reservedBytes/usedBytes/nextTaskNumber）。
 *
 * ⚠️ 单例隔离（必须在动态 import 前）：
 *  - `vi.mock("@/server/db/prisma")` 绑定 TEST_DATABASE_URL；
 *  - `APP_ENV="test"` 关闭 Better Auth 限流；
 *  - 会话夹具用同一个 auth 单例签发 cookie。
 *
 * 说明：orbit_test 是干净库（不含业务种子），故本文件自建用户 + 自建项目/任务作为夹具，
 * 不依赖 seed 数据；afterAll 回收本 run 数据以保持库纯净。
 */

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);

/** 仅供测试的固定密钥（≥32），非任何真实凭证。 */
const TEST_SECRET = "orbit-contract-envelope-test-secret-0123456789";

/* ── 环境覆写：关闭限流 + 固定测试密钥（必须在动态 import 前）────────────── */
process.env.APP_ENV = "test";
process.env.BETTER_AUTH_SECRET = TEST_SECRET;
getEnv(true);

/**
 * 把应用 Prisma 单例替换为绑定 orbit_test 的客户端（惰性工厂，首次 import 时执行）。
 * 连接池 max=15；事务超时目标——写事务应在秒级完成或快速失败。
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

const RUN_TAG = `contract-${Date.now()}`;
const domain = "orbit.test";
const EMAIL = `${RUN_TAG}@${domain}`;
const PASSWORD = "ContractEnvelopeTest!Pass0rd";
const NAME = "契约信封测试用户";

let cookie = "";
let projectIdA = "";
let taskIdT1 = "";
let taskT1Version = 1;

const BASE = `${env.BETTER_AUTH_URL}/api/v1`;
const TRUSTED_ORIGIN =
  env.AUTH_TRUSTED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0] ?? env.BETTER_AUTH_URL;

/** key 前缀：run 唯一，确保跨运行不撞 DB 全局唯一约束。 */
const KEY_PREFIX = `C${Date.now().toString(36).slice(-4).toUpperCase()}`;
let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `${KEY_PREFIX}${String(keyCounter).padStart(2, "0")}`.slice(0, 8);
}

/* ── 信封校验器（strict，形状不合契约直接抛错）────────────────────────── */
const ProjectSuccess = SuccessResponseSchema(ProjectSchema);
const ProjectListSuccess = ListResponseSchema(ProjectSchema);
const TaskSuccess = SuccessResponseSchema(TaskSchema);
const TaskSummaryList = ListResponseSchema(TaskSummarySchema);
const TaskDeletedSuccess = SuccessResponseSchema(DeletedTaskSchema);
const MemberListSuccess = SuccessResponseSchema(z.array(MemberSchema));
const ErrorSuccess = ErrorResponseSchema;

/* ── 请求辅助 ─────────────────────────────────────────────────────────── */

interface ReqOptions {
  cookie?: string | null;
  body?: unknown;
  origin?: string | null;
  idempotencyKey?: string;
  requestId?: string;
}

function buildRequest(method: string, url: string, options: ReqOptions = {}): Request {
  const { cookie: c = null, body, origin = TRUSTED_ORIGIN, idempotencyKey, requestId } = options;
  const headers = new Headers();
  if (c) headers.set("cookie", c);
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

/** 回收本 run 数据（FK onDelete:Restrict，须按 子→父 顺序删除）。 */
async function cleanupRun(): Promise<void> {
  const users = await testPrisma.user.findMany({
    where: { email: { contains: RUN_TAG } },
    select: { id: true },
  });
  const userIds = users.map((u: { id: string }) => u.id);
  if (userIds.length === 0) return;
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
  await cleanupRun();

  // 尝试初始化夹具
  const _emailCookie = await signUpVerified(EMAIL, NAME);
  cookie = await signIn(EMAIL);
  expect(cookie).toContain("session_token");

  // 自建夹具项目 A（当前用户为 owner），供列表/详情/任务信封测试使用。
  const projectRes = await projectsRoute.POST(
    buildRequest("POST", `${BASE}/projects`, {
      cookie,
      body: { name: "契约信封项目 A", key: nextKey(), color: "BLUE" },
      idempotencyKey: randomUUID(),
    }),
  );
  expect(projectRes.status).toBe(201);
  const project = ProjectSuccess.parse((await projectRes.json()) as unknown).data;
  projectIdA = project.id;

  // 自建夹具任务 T1（属于项目 A）。
  const taskRes = await tasksRoute.POST(
    buildRequest("POST", `${BASE}/projects/${projectIdA}/tasks`, {
      cookie,
      body: { title: "契约信封任务 T1", status: "TODO", priority: "MEDIUM" },
      idempotencyKey: randomUUID(),
    }),
    ctxProject(projectIdA),
  );
  expect(taskRes.status).toBe(201);
  const task = TaskSuccess.parse((await taskRes.json()) as unknown).data;
  taskIdT1 = task.id;
  taskT1Version = task.version;
}, 120_000);

afterAll(async () => {
  try { await cleanupRun(); } finally { await testPrisma.$disconnect(); }
});

/**
 * 断言响应头一致性：Cache-Control: private, no-store + x-request-id == meta.requestId。
 */
function assertEnvelopeHeaders(response: Response, expectedRequestId: string): void {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get(REQUEST_ID_HEADER)).toBe(expectedRequestId);
}

/** 断言 PageMeta 形状：requestId(string) + hasMore(boolean) + nextCursor(string|null)。 */
function assertPageMeta(meta: { requestId: string; nextCursor: string | null; hasMore: boolean }): void {
  expect(typeof meta.requestId).toBe("string");
  expect(typeof meta.hasMore).toBe("boolean");
  expect(meta.nextCursor === null || typeof meta.nextCursor === "string").toBe(true);
}

/** 断言 ProjectDTO 不含内部字段（见 src/server/modules/project/mappers.ts）。 */
function assertProjectDtoFields(data: ProjectDTO): void {
  expect(data).not.toHaveProperty("reservedBytes");
  expect(data).not.toHaveProperty("usedBytes");
  expect(data).not.toHaveProperty("nextTaskNumber");
}

/** 断言 TaskDTO 不含 position（TaskSchema 无此字段，docs/04 §5）。 */
function assertTaskDtoFields(data: TaskDTO): void {
  expect(data).not.toHaveProperty("position");
}

/* ── T1: 项目列表 → GET /projects ──────────────────────────────────────── */

describe("GET /projects（列表信封）", () => {
  it("返回列表且 meta 含 requestId / nextCursor(可空) / hasMore", async () => {
    const request = buildRequest("GET", `${BASE}/projects?limit=2`, { cookie });
    const response = await projectsRoute.GET(request);
    expect(response.status).toBe(200);

    const parsed = ProjectListSuccess.parse((await response.json()) as unknown);
    assertEnvelopeHeaders(response, parsed.meta.requestId);
    expect(parsed.data).toBeInstanceOf(Array);
    assertPageMeta(parsed.meta);
  });
});

/* ── T2: 任务列表 → GET /projects/:id/tasks ──────────────────────────────── */

describe("GET /projects/:id/tasks（列表信封）", () => {
  it("返回任务列表且 meta 含 requestId / nextCursor(可空) / hasMore", async () => {
    const request = buildRequest("GET", `${BASE}/projects/${projectIdA}/tasks?limit=10`, { cookie });
    const response = await tasksRoute.GET(request, ctxProject(projectIdA));
    expect(response.status).toBe(200);

    const parsed = TaskSummaryList.parse((await response.json()) as unknown);
    assertEnvelopeHeaders(response, parsed.meta.requestId);
    expect(parsed.data).toBeInstanceOf(Array);
    assertPageMeta(parsed.meta);
  });
});

/* ── T3: 创建项目 → POST /projects（成功信封 + 幂等重放）────────────────── */

describe("POST /projects（成功信封 + 幂等）", () => {
  it("创建成功返回 ProjectDTO（含 requestId，不含内部字段），幂等重放返回同一数据", async () => {
    const idempotencyKey = randomUUID();
    const body = { name: "契约测试项目", key: nextKey(), color: "PURPLE" };

    const request = buildRequest("POST", `${BASE}/projects`, { cookie, body, idempotencyKey });
    const response = await projectsRoute.POST(request);
    expect(response.status).toBe(201);
    const parsed = ProjectSuccess.parse((await response.json()) as unknown);
    assertEnvelopeHeaders(response, parsed.meta.requestId);
    assertProjectDtoFields(parsed.data);

    // 同 key 同 body 重放 → 200 且返回同一项目（幂等，docs/05 §5）。
    const replay = await projectsRoute.POST(
      buildRequest("POST", `${BASE}/projects`, { cookie, body, idempotencyKey }),
    );
    expect(replay.status).toBe(200);
    const replayParsed = ProjectSuccess.parse((await replay.json()) as unknown);
    expect(replayParsed.data.id).toBe(parsed.data.id);
  });
});

/* ── T4: 创建任务 → POST /projects/:id/tasks ────────────────────────────── */

describe("POST /projects/:id/tasks（成功信封 + TaskDTO 字段）", () => {
  it("创建成功返回 TaskDTO（meta 含 requestId，不含 position）", async () => {
    const body = { title: "契约测试任务", status: "TODO", priority: "MEDIUM" };
    const request = buildRequest("POST", `${BASE}/projects/${projectIdA}/tasks`, {
      cookie,
      body,
      idempotencyKey: randomUUID(),
    });
    const response = await tasksRoute.POST(request, ctxProject(projectIdA));
    expect(response.status).toBe(201);
    const parsed = TaskSuccess.parse((await response.json()) as unknown);
    assertEnvelopeHeaders(response, parsed.meta.requestId);
    assertTaskDtoFields(parsed.data);
  });
});

/* ── T5: 更新任务 → PATCH /tasks/:id（版本冲突错误信封）─────────────────── */

describe("PATCH /tasks/:id（错误信封 + 版本冲突）", () => {
  it("expectedVersion 不符 → 409 VERSION_CONFLICT，含 requestId 与 currentVersion", async () => {
    const wrongVersion = taskT1Version + 100;
    const body = { status: "IN_PROGRESS", expectedVersion: wrongVersion };
    const request = buildRequest("PATCH", `${BASE}/tasks/${taskIdT1}`, { cookie, body });
    const response = await taskRoute.PATCH(request, ctxTask(taskIdT1));
    expect(response.status).toBe(409);
    const errorParsed = ErrorSuccess.parse((await response.json()) as unknown);
    assertEnvelopeHeaders(response, errorParsed.meta.requestId);
    expect(errorParsed.error.code).toBe("VERSION_CONFLICT");
    expect(errorParsed.error.currentVersion).toBe(taskT1Version);
  });
});

/* ── T6: 删除任务 → DELETE /tasks/:id（软删除信封）──────────────────────── */

describe("DELETE /tasks/:id（软删除信封）", () => {
  it("soft-delete 返回 DeletedTaskDTO，meta 含 requestId，version+1", async () => {
    // 先创建一个新任务来删除（避免删除夹具任务 T1）。
    const createReq = buildRequest("POST", `${BASE}/projects/${projectIdA}/tasks`, {
      cookie,
      body: { title: "删除测试任务", status: "TODO", priority: "NONE" },
      idempotencyKey: randomUUID(),
    });
    const createdRes = await tasksRoute.POST(createReq, ctxProject(projectIdA));
    expect(createdRes.status).toBe(201);
    const created = TaskSuccess.parse((await createdRes.json()) as unknown).data;

    const delReq = buildRequest(
      "DELETE",
      `${BASE}/tasks/${created.id}?expectedVersion=${created.version}`,
      { cookie },
    );
    const response = await taskRoute.DELETE(delReq, ctxTask(created.id));
    expect(response.status).toBe(200);
    const deletedParsed = TaskDeletedSuccess.parse((await response.json()) as unknown);
    assertEnvelopeHeaders(response, deletedParsed.meta.requestId);
    expect(deletedParsed.data.version).toBe(created.version + 1);
  });
});

/* ── T7: 错误信封统一性（不存在项目 → 404 NOT_FOUND）────────────────────── */

describe("错误信封（不存在项目 → 404 NOT_FOUND）", () => {
  it("访问不存在/非成员项目 → 404 NOT_FOUND，meta 含 requestId", async () => {
    const fakeUuid = "00000000-0000-4000-8000-bbbbbbbbbbbb";
    const req = buildRequest("GET", `${BASE}/projects/${fakeUuid}`, { cookie });
    const response = await projectRoute.GET(req, ctxProject(fakeUuid));
    expect(response.status).toBe(404);
    const errorParsed = ErrorSuccess.parse((await response.json()) as unknown);
    assertEnvelopeHeaders(response, errorParsed.meta.requestId);
    expect(errorParsed.error.code).toBe("NOT_FOUND");
  });
});

/* ── T8: Cache-Control 对所有响应统一生效 ─────────────────────────────── */

describe("Cache-Control: private, no-store（所有响应）", () => {
  it("GET /projects → Cache-Control header", async () => {
    const req = buildRequest("GET", `${BASE}/projects?limit=1`, { cookie });
    const res = await projectsRoute.GET(req);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("GET /projects/:id → Cache-Control header", async () => {
    const req = buildRequest("GET", `${BASE}/projects/${projectIdA}`, { cookie });
    const res = await projectRoute.GET(req, ctxProject(projectIdA));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("GET /projects/:id/tasks → Cache-Control header", async () => {
    const req = buildRequest("GET", `${BASE}/projects/${projectIdA}/tasks?limit=10`, { cookie });
    const res = await tasksRoute.GET(req, ctxProject(projectIdA));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

 it("GET /tasks/:id → Cache-Control header", async () => {
    const req = buildRequest("GET", `${BASE}/tasks/${taskIdT1}`, { cookie });
    const res = await taskRoute.GET(req, ctxTask(taskIdT1));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

/* ── T9: 成员列表 → GET /projects/:id/members（非分页成功信封）──────────── */

describe("GET /projects/:id/members（成员列表信封）", () => {
  it("返回 {data: Member[], meta:{requestId}}，每项含 role、不含 email，Cache-Control 一致", async () => {
    // 自建一名成员用户 + 一个含两名成员的新项目，避免影响共享夹具。
    const memberEmail = `${RUN_TAG}-member@${domain}`;
    await signUpVerified(memberEmail, "契约成员乙");
    const memberUser = await testPrisma.user.findUniqueOrThrow({ where: { email: memberEmail } });

    const projRes = await projectsRoute.POST(
      buildRequest("POST", `${BASE}/projects`, {
        cookie,
        body: { name: "成员信封项目", key: nextKey() },
        idempotencyKey: randomUUID(),
      }),
    );
    expect(projRes.status).toBe(201);
    const proj = ProjectSuccess.parse((await projRes.json()) as unknown).data;
    await testPrisma.projectMember.create({
      data: { projectId: proj.id, userId: memberUser.id },
    });

    const response = await membersRoute.GET(
      buildRequest("GET", `${BASE}/projects/${proj.id}/members`, { cookie }),
      ctxProject(proj.id),
    );
    expect(response.status).toBe(200);
    const parsed = MemberListSuccess.parse((await response.json()) as unknown);
    assertEnvelopeHeaders(response, parsed.meta.requestId);

    // 成员信封为非分页 SuccessEnvelope：data 为 Member[]（owner 首位 + 成员）。
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(parsed.data).toHaveLength(2);
    for (const member of parsed.data) {
      expect(["OWNER", "MEMBER"]).toContain(member.role);
      // 不含 email 之外的敏感字段；MemberSchema strict 已排除，双保险再断言无 email。
      expect(member).not.toHaveProperty("email");
    }
    expect(parsed.data[0]).toMatchObject({ role: "OWNER" });
    expect(parsed.data.some((m) => m.role === "MEMBER")).toBe(true);
    // 绝不向队友披露 email（docs/05 §4）。
    expect(JSON.stringify(parsed.data)).not.toContain(memberEmail);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

/* ── T10: 恢复任务 → POST /tasks/:id/restore（成功信封）────────────────── */

describe("POST /tasks/:id/restore（恢复成功信封）", () => {
  it("restore → SuccessEnvelope，data.deletedAt===null、version+1、不含 position，Cache-Control 一致", async () => {
    // 新建 → 软删除 → 恢复，全程用独立任务，不动共享夹具 T1。
    const createRes = await tasksRoute.POST(
      buildRequest("POST", `${BASE}/projects/${projectIdA}/tasks`, {
        cookie,
        body: { title: "恢复信封任务", status: "TODO", priority: "NONE" },
        idempotencyKey: randomUUID(),
      }),
      ctxProject(projectIdA),
    );
    expect(createRes.status).toBe(201);
    const created = TaskSuccess.parse((await createRes.json()) as unknown).data;

    const delRes = await taskRoute.DELETE(
      buildRequest("DELETE", `${BASE}/tasks/${created.id}?expectedVersion=${created.version}`, {
        cookie,
      }),
      ctxTask(created.id),
    );
    expect(delRes.status).toBe(200);
    const deleted = TaskDeletedSuccess.parse((await delRes.json()) as unknown).data;

    const response = await restoreRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${created.id}/restore`, {
        cookie,
        body: { expectedVersion: deleted.version },
        idempotencyKey: randomUUID(),
      }),
      ctxTask(created.id),
    );
    expect(response.status).toBe(200);
    const parsed = TaskSuccess.parse((await response.json()) as unknown);
    assertEnvelopeHeaders(response, parsed.meta.requestId);
    expect(parsed.data.id).toBe(created.id);
    expect(parsed.data.deletedAt).toBeNull();
    expect(parsed.data.version).toBe(deleted.version + 1);
    assertTaskDtoFields(parsed.data); // 不含 position
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

/* ── T11: 更新项目 → PATCH /projects/:id（成功信封 + openTaskCount 真实计数）── */

describe("PATCH /projects/:id（更新成功信封 + openTaskCount 真实值）", () => {
  it("PATCH → SuccessEnvelope，version+1，openTaskCount 为真实计数（非硬编码 0），不含内部字段", async () => {
    // 自建带任务的新项目：2 个未完成 + 1 个 DONE → openTaskCount 应为 2。
    const projRes = await projectsRoute.POST(
      buildRequest("POST", `${BASE}/projects`, {
        cookie,
        body: { name: "更新信封项目", key: nextKey() },
        idempotencyKey: randomUUID(),
      }),
    );
    expect(projRes.status).toBe(201);
    const proj = ProjectSuccess.parse((await projRes.json()) as unknown).data;

    await tasksRoute.POST(
      buildRequest("POST", `${BASE}/projects/${proj.id}/tasks`, {
        cookie,
        body: { title: "未完成一" },
        idempotencyKey: randomUUID(),
      }),
      ctxProject(proj.id),
    );
    await tasksRoute.POST(
      buildRequest("POST", `${BASE}/projects/${proj.id}/tasks`, {
        cookie,
        body: { title: "未完成二" },
        idempotencyKey: randomUUID(),
      }),
      ctxProject(proj.id),
    );
    const doneRes = await tasksRoute.POST(
      buildRequest("POST", `${BASE}/projects/${proj.id}/tasks`, {
        cookie,
        body: { title: "已完成" },
        idempotencyKey: randomUUID(),
      }),
      ctxProject(proj.id),
    );
    const doneTask = TaskSuccess.parse((await doneRes.json()) as unknown).data;
    await taskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/tasks/${doneTask.id}`, {
        cookie,
        body: { expectedVersion: doneTask.version, status: "DONE" },
      }),
      ctxTask(doneTask.id),
    );

    const response = await projectRoute.PATCH(
      buildRequest("PATCH", `${BASE}/projects/${proj.id}`, {
        cookie,
        body: { expectedVersion: proj.version, name: "更新后名字" },
      }),
      ctxProject(proj.id),
    );
    expect(response.status).toBe(200);
    const parsed = ProjectSuccess.parse((await response.json()) as unknown);
    assertEnvelopeHeaders(response, parsed.meta.requestId);
    expect(parsed.data.name).toBe("更新后名字");
    expect(parsed.data.version).toBe(proj.version + 1);
    // openTaskCount 为真实计数（2 个未完成），验证 PATCH 响应不再硬编码 0。
    expect(parsed.data.openTaskCount).toBe(2);
    assertProjectDtoFields(parsed.data);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

/* ── T12: 更新任务成功路径 → PATCH /tasks/:id（200 成功信封）────────────── */

describe("PATCH /tasks/:id（更新成功信封）", () => {
  it("成功 PATCH → SuccessEnvelope，data.version 恰 +1，字段白名单（不含 position），Cache-Control 一致", async () => {
    const createRes = await tasksRoute.POST(
      buildRequest("POST", `${BASE}/projects/${projectIdA}/tasks`, {
        cookie,
        body: { title: "待更新任务", status: "TODO", priority: "MEDIUM" },
        idempotencyKey: randomUUID(),
      }),
      ctxProject(projectIdA),
    );
    expect(createRes.status).toBe(201);
    const created = TaskSuccess.parse((await createRes.json()) as unknown).data;

    const response = await taskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/tasks/${created.id}`, {
        cookie,
        body: { expectedVersion: created.version, title: "更新后标题" },
      }),
      ctxTask(created.id),
    );
    expect(response.status).toBe(200);
    const parsed = TaskSuccess.parse((await response.json()) as unknown);
    assertEnvelopeHeaders(response, parsed.meta.requestId);
    expect(parsed.data.id).toBe(created.id);
    expect(parsed.data.title).toBe("更新后标题");
    // 一次 PATCH 只 +1 version。
    expect(parsed.data.version).toBe(created.version + 1);
    assertTaskDtoFields(parsed.data); // 字段白名单：不含 position
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
