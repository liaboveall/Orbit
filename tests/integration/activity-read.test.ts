import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import {
  ActivitySchema,
  ErrorResponseSchema,
  ListResponseSchema,
  ProjectSchema,
  SuccessResponseSchema,
  TaskSchema,
  type ActivityDTO,
  type ErrorResponse,
  type ProjectDTO,
  type TaskDTO,
} from "@/contracts";
import { getEnv, parseEnv } from "@/server/env";

/**
 * M4 / ORB-011：项目活动读取集成验证（activity-read）。
 *
 * 与 activity.test.ts（M2，验证「活动随事务写入」）互补：本文件验证 **GET 读取侧**
 * `/api/v1/projects/{projectId}/activity` 的列表信封、keyset 游标分页与授权。
 * 同一套基础设施：在**独立测试库 orbit_test**（TEST_DATABASE_URL）上直接调用 Next.js
 * route handler（纯 `(Request, ctx?) => Response`），覆盖真实路由编排
 * （请求 ID → 会话 → PaginationQuerySchema → 领域服务 listActivities → 列表信封）。
 *
 * 覆盖：列活动 happy path（DESC 排序 + actor/entityType/action/metadata 完整）、
 * 成员可读、分页（41 条 → 20/20/1，末页 nextCursor=null）、limit 生效、
 * 非法 limit → 400 VALIDATION_ERROR、非法 cursor → 400 INVALID_CURSOR、
 * 非成员 → 404 NOT_FOUND、未认证 → 401 UNAUTHENTICATED。
 *
 * ⚠️ 授权约定（src/server/modules/activity/reader.ts + docs/03 §5、docs/05 §3）：
 *  - 成员可见（owner 亦为成员）；非成员/项目不存在统一 **404 NOT_FOUND**（不泄露存在性）；
 *  - 未认证 **401 UNAUTHENTICATED**。
 *
 * ⚠️ 分页约定（reader.ts）：keyset 游标，排序 createdAt DESC, id DESC；limit 默认 30、
 *  上限 100（超限先被 PaginationQuerySchema 拦为 400）；take limit+1 判 hasMore；
 *  末页 nextCursor=null。为使分页确定，本文件直接插入带**显式递减 createdAt** 的合成活动。
 *
 * ⚠️ 单例隔离（必须在动态 import 前）：vi.mock 绑定 TEST_DATABASE_URL + APP_ENV=test 关闭限流；
 * 会话夹具用**同一个** auth 单例签发 cookie。
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);

/** 仅供测试的固定密钥（≥32），非任何真实凭证。 */
const TEST_SECRET = "orbit-integration-activity-read-test-secret-0123456789";

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
const tasksRoute = await import("@/app/api/v1/projects/[projectId]/tasks/route");
const activityRoute = await import("@/app/api/v1/projects/[projectId]/activity/route");
const { auth } = await import("@/server/auth");
const { prisma: testPrisma } = await import("@/server/db/prisma");

/* ── 夹具常量 ─────────────────────────────────────────────────────────── */

const RUN_TAG = `actread-${Date.now()}`;
const domain = "orbit.test";
const EMAIL_A = `${RUN_TAG}-a@${domain}`; // 项目 owner（读取活动）
const EMAIL_B = `${RUN_TAG}-b@${domain}`; // 普通成员（成员可读）
const EMAIL_D = `${RUN_TAG}-d@${domain}`; // 局外用户（非成员 → 404）
const PASSWORD = "IntegrationActRead!Pass0rd";
const NAME_A = "活动读取所有者";
const NAME_B = "活动读取成员";
const NAME_D = "局外丁";

const BASE = `${env.BETTER_AUTH_URL}/api/v1`;
const TRUSTED_ORIGIN =
  env.AUTH_TRUSTED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0] ?? env.BETTER_AUTH_URL;

/** key 前缀：run 唯一，确保跨运行不撞 DB 全局唯一约束（`/^[A-Z][A-Z0-9]{1,7}$/`，≤8 位）。 */
const KEY_PREFIX = `R${Date.now().toString(36).slice(-4).toUpperCase()}`;
let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `${KEY_PREFIX}${String(keyCounter).padStart(2, "0")}`.slice(0, 8);
}

/* ── 信封校验器（strict，形状不合契约直接抛错）────────────────────────── */
const ProjectSuccess = SuccessResponseSchema(ProjectSchema);
const TaskSuccess = SuccessResponseSchema(TaskSchema);
const ActivityList = ListResponseSchema(ActivitySchema);

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

function ctxProject(projectId: string): { params: Promise<{ projectId: string }> } {
  return { params: Promise.resolve({ projectId }) };
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
let cookieD = "";
let userAId = "";
let userBId = "";
let userDId = "";

/** 回收本 run 数据（FK onDelete:Restrict，须按 子→父 顺序删除）。 */
async function cleanupRun(): Promise<void> {
  const users = await testPrisma.user.findMany({
    where: { email: { contains: RUN_TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) {
    await testPrisma.verification.deleteMany({ where: { identifier: { contains: RUN_TAG } } });
    return;
  }
  const projects = await testPrisma.project.findMany({
    where: { ownerId: { in: userIds } },
    select: { id: true },
  });
  const projectIds = projects.map((p) => p.id);
  await testPrisma.activityLog.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.idempotencyRecord.deleteMany({ where: { userId: { in: userIds } } });
  await testPrisma.invitation.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.task.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.projectMember.deleteMany({
    where: { OR: [{ projectId: { in: projectIds } }, { userId: { in: userIds } }] },
  });
  await testPrisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await testPrisma.user.deleteMany({ where: { id: { in: userIds } } });
  await testPrisma.verification.deleteMany({ where: { identifier: { contains: RUN_TAG } } });
}

/** afterEach：回收本 run 项目及其从属数据（保留用户与会话），使各用例彼此隔离。 */
async function cleanupProjects(): Promise<void> {
  const userIds = [userAId, userBId, userDId].filter((id) => id.length > 0);
  if (userIds.length === 0) return;
  const projects = await testPrisma.project.findMany({
    where: { ownerId: { in: userIds } },
    select: { id: true },
  });
  const projectIds = projects.map((p) => p.id);
  await testPrisma.activityLog.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.idempotencyRecord.deleteMany({ where: { userId: { in: userIds } } });
  await testPrisma.invitation.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.task.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.projectMember.deleteMany({
    where: { OR: [{ projectId: { in: projectIds } }, { userId: { in: userIds } }] },
  });
  await testPrisma.project.deleteMany({ where: { id: { in: projectIds } } });
}

beforeAll(async () => {
  await cleanupRun();
  await signUpVerified(EMAIL_A, NAME_A);
  await signUpVerified(EMAIL_B, NAME_B);
  await signUpVerified(EMAIL_D, NAME_D);
  cookieA = await signIn(EMAIL_A);
  cookieB = await signIn(EMAIL_B);
  cookieD = await signIn(EMAIL_D);
  expect(cookieA).toContain("session_token");
  const a = await testPrisma.user.findUniqueOrThrow({ where: { email: EMAIL_A } });
  const b = await testPrisma.user.findUniqueOrThrow({ where: { email: EMAIL_B } });
  const d = await testPrisma.user.findUniqueOrThrow({ where: { email: EMAIL_D } });
  userAId = a.id;
  userBId = b.id;
  userDId = d.id;
}, 180_000);

afterEach(async () => {
  await cleanupProjects();
});

afterAll(async () => {
  await cleanupRun();
  await testPrisma.$disconnect();
});

/* ── 领域辅助 ─────────────────────────────────────────────────────────── */

/** A 创建项目并断言 201，返回 ProjectDTO。 */
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

/** A 在项目内创建任务并断言 201（每次生成 1 条 TASK_CREATED 活动）。 */
async function createTaskOk(projectId: string, title: string): Promise<TaskDTO> {
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

/** 直接把某用户加为项目成员（模拟既有成员）。 */
async function addMember(projectId: string, userId: string): Promise<void> {
  await testPrisma.projectMember.create({ data: { projectId, userId } });
}

/**
 * 直接插入 count 条合成活动，createdAt 从 baseTime 起**严格递减**（baseTime-1s、-2s…），
 * 以获得确定的 keyset 排序（reader 按 createdAt DESC, id DESC）。metadata 省略 → DB 默认 {}。
 * 返回插入条数。baseTime 应取项目真实活动（PROJECT_CREATED）的时间，使合成活动均更旧。
 */
async function seedSyntheticActivities(
  projectId: string,
  count: number,
  baseTime: number,
): Promise<number> {
  await testPrisma.activityLog.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      projectId,
      actorId: userAId,
      entityType: "TASK" as const,
      entityId: `synthetic-${i}`,
      action: "TASK_CREATED" as const,
      createdAt: new Date(baseTime - (i + 1) * 1000),
    })),
  });
  return count;
}

/** GET /projects/{id}/activity（默认以 A 的身份），query 为可选查询串（含前导 `?`）。 */
async function getActivity(
  projectId: string,
  opts: { cookie?: string | null; query?: string } = {},
): Promise<Response> {
  const { cookie = cookieA, query = "" } = opts;
  return activityRoute.GET(
    buildRequest("GET", `${BASE}/projects/${projectId}/activity${query}`, { cookie }),
    ctxProject(projectId),
  );
}

/** 断言 200 并按列表信封解析，返回 {data, meta}。 */
async function parseActivityList(response: Response): Promise<{
  data: ActivityDTO[];
  meta: { requestId: string; nextCursor: string | null; hasMore: boolean };
}> {
  expect(response.status).toBe(200);
  const parsed = ActivityList.parse((await response.json()) as unknown);
  return { data: parsed.data, meta: parsed.meta };
}

/** 构造下一页查询串（URLSearchParams 正确编码 cursor）。 */
function pageQuery(cursor: string, limit = 20): string {
  return `?${new URLSearchParams({ cursor, limit: String(limit) }).toString()}`;
}

/* ── 1. 列活动（happy path）──────────────────────────────────────────── */

describe("列活动 · happy path", () => {
  it("GET → 200 列表信封；createdAt DESC；每项含 actor/entityType/action/metadata；少于一页时 nextCursor=null", async () => {
    const project = await createProjectOk("活动读取项目 A");
    // 项目创建（1 条 PROJECT_CREATED）+ 3 个任务（3 条 TASK_CREATED）= 4 条活动。
    await createTaskOk(project.id, "活动任务一");
    await createTaskOk(project.id, "活动任务二");
    await createTaskOk(project.id, "活动任务三");

    const { data, meta } = await parseActivityList(await getActivity(project.id));

    // 4 条 < 默认 limit(30)：单页返回全部，无下一页。
    expect(data).toHaveLength(4);
    expect(meta.hasMore).toBe(false);
    expect(meta.nextCursor).toBeNull();
    expect(typeof meta.requestId).toBe("string");

    // 排序：createdAt 非严格递增（DESC）。
    for (let i = 0; i < data.length - 1; i += 1) {
      expect(new Date(data[i]!.createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(data[i + 1]!.createdAt).getTime(),
      );
    }

    // 最新一条为 TASK_CREATED，最旧一条为 PROJECT_CREATED（entityId=项目）。
    expect(data[0]!.action).toBe("TASK_CREATED");
    const oldest = data[data.length - 1]!;
    expect(oldest.action).toBe("PROJECT_CREATED");
    expect(oldest.entityType).toBe("PROJECT");
    expect(oldest.entityId).toBe(project.id);
    expect(oldest.metadata).toEqual({});

    // 每项字段完整且归属正确：actor 为 A、projectId 一致、metadata 为对象。
    for (const item of data) {
      expect(item.projectId).toBe(project.id);
      expect(item.actor.id).toBe(userAId);
      expect(item.actor.name).toBe(NAME_A);
      expect(typeof item.entityId).toBe("string");
      expect(item.entityId.length).toBeGreaterThan(0);
      expect(typeof item.metadata).toBe("object");
    }
    // TASK_CREATED 项带 metadata.taskIdentifier（形如 `${key}-${number}`）。
    const created = data.find((d) => d.action === "TASK_CREATED")!;
    expect(created.entityType).toBe("TASK");
    expect(typeof created.metadata.taskIdentifier).toBe("string");
    expect(created.metadata.taskIdentifier!.startsWith(`${project.key}-`)).toBe(true);
  });

  it("普通成员 GET → 200（成员可见，与 owner 读到同一份活动）", async () => {
    const project = await createProjectOk("活动读取项目 · 成员可见");
    await createTaskOk(project.id, "成员可见任务");
    await addMember(project.id, userBId);

    const asOwner = await parseActivityList(await getActivity(project.id, { cookie: cookieA }));
    const asMember = await parseActivityList(await getActivity(project.id, { cookie: cookieB }));

    expect(asMember.data.map((d) => d.id)).toEqual(asOwner.data.map((d) => d.id));
    expect(asMember.data.length).toBe(2); // PROJECT_CREATED + TASK_CREATED
  });
});

/* ── 2. 分页 ─────────────────────────────────────────────────────────── */

describe("列活动 · keyset 游标分页", () => {
  it("41 条活动 limit=20 → 20/20/1；跨页无重叠、全局 DESC；末页 nextCursor=null、hasMore=false", async () => {
    const project = await createProjectOk("活动分页项目");
    // 以真实 PROJECT_CREATED 活动时间为基准，插入 40 条更旧的合成活动 → 合计 41 条。
    const projectActivity = await testPrisma.activityLog.findFirstOrThrow({
      where: { projectId: project.id, action: "PROJECT_CREATED" },
    });
    await seedSyntheticActivities(project.id, 40, projectActivity.createdAt.getTime());
    expect(await testPrisma.activityLog.count({ where: { projectId: project.id } })).toBe(41);

    // 第 1 页：20 条 + hasMore + nextCursor。
    const page1 = await parseActivityList(await getActivity(project.id, { query: "?limit=20" }));
    expect(page1.data).toHaveLength(20);
    expect(page1.meta.hasMore).toBe(true);
    expect(page1.meta.nextCursor).not.toBeNull();
    // 最新一条为项目创建（合成活动均更旧）。
    expect(page1.data[0]!.action).toBe("PROJECT_CREATED");
    expect(page1.data[0]!.entityId).toBe(project.id);

    // 第 2 页：用第 1 页游标续读 20 条。
    const page2 = await parseActivityList(
      await getActivity(project.id, { query: pageQuery(page1.meta.nextCursor!) }),
    );
    expect(page2.data).toHaveLength(20);
    expect(page2.meta.hasMore).toBe(true);
    expect(page2.meta.nextCursor).not.toBeNull();

    // 第 3 页（末页）：仅剩 1 条，nextCursor=null、hasMore=false。
    const page3 = await parseActivityList(
      await getActivity(project.id, { query: pageQuery(page2.meta.nextCursor!) }),
    );
    expect(page3.data).toHaveLength(1);
    expect(page3.meta.hasMore).toBe(false);
    expect(page3.meta.nextCursor).toBeNull();

    // 跨页无重叠：41 条 id 唯一。
    const all = [...page1.data, ...page2.data, ...page3.data];
    expect(all).toHaveLength(41);
    expect(new Set(all.map((a) => a.id)).size).toBe(41);

    // 全局排序仍为 createdAt 非严格递增（DESC），跨页边界亦成立。
    for (let i = 0; i < all.length - 1; i += 1) {
      expect(new Date(all[i]!.createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(all[i + 1]!.createdAt).getTime(),
      );
    }
  });

  it("limit 生效：41 条活动 limit=5 → 恰 5 条 + hasMore + nextCursor", async () => {
    const project = await createProjectOk("活动分页项目 · limit");
    const projectActivity = await testPrisma.activityLog.findFirstOrThrow({
      where: { projectId: project.id, action: "PROJECT_CREATED" },
    });
    await seedSyntheticActivities(project.id, 40, projectActivity.createdAt.getTime());

    const { data, meta } = await parseActivityList(
      await getActivity(project.id, { query: "?limit=5" }),
    );
    expect(data).toHaveLength(5);
    expect(meta.hasMore).toBe(true);
    expect(meta.nextCursor).not.toBeNull();
  });

  it("非法 limit（>100 或 <1）→ 400 VALIDATION_ERROR", async () => {
    const project = await createProjectOk("活动分页项目 · 非法 limit");

    const tooLarge = await getActivity(project.id, { query: "?limit=200" });
    expect(tooLarge.status).toBe(400);
    expect((await readError(tooLarge)).error.code).toBe("VALIDATION_ERROR");

    const tooSmall = await getActivity(project.id, { query: "?limit=0" });
    expect(tooSmall.status).toBe(400);
    expect((await readError(tooSmall)).error.code).toBe("VALIDATION_ERROR");
  });

  it("非法 cursor（过滤指纹不匹配）→ 400 INVALID_CURSOR", async () => {
    const project = await createProjectOk("活动分页项目 · 非法 cursor");
    // 结构合法但指纹伪造为全零 → decodeCursor 指纹校验失败（不依赖 base64/JSON 偶然性）。
    const bogusCursor = Buffer.from(
      JSON.stringify({
        v: ["2020-01-01T00:00:00.000Z", randomUUID()],
        id: randomUUID(),
        f: "0".repeat(16),
      }),
      "utf8",
    ).toString("base64url");

    const response = await getActivity(project.id, { query: pageQuery(bogusCursor) });
    expect(response.status).toBe(400);
    expect((await readError(response)).error.code).toBe("INVALID_CURSOR");
  });
});

/* ── 3. 非成员访问 → 404 ─────────────────────────────────────────────── */

describe("列活动 · 授权", () => {
  it("非成员 GET → 404 NOT_FOUND（不是 403，不泄露项目是否存在）", async () => {
    const project = await createProjectOk("活动读取项目 · 非成员");
    await createTaskOk(project.id, "非成员不可见任务");

    const response = await getActivity(project.id, { cookie: cookieD });
    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("NOT_FOUND");
  });

  it("项目不存在（随机 id）GET → 404 NOT_FOUND", async () => {
    const response = await getActivity(randomUUID(), { cookie: cookieA });
    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("NOT_FOUND");
  });
});

/* ── 4. 未认证 → 401 ─────────────────────────────────────────────────── */

describe("列活动 · 未认证", () => {
  it("无会话 GET → 401 UNAUTHENTICATED", async () => {
    const project = await createProjectOk("活动读取项目 · 未认证");
    const response = await getActivity(project.id, { cookie: null });
    expect(response.status).toBe(401);
    expect((await readError(response)).error.code).toBe("UNAUTHENTICATED");
  });
});
