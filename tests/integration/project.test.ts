import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ErrorResponseSchema,
  ListResponseSchema,
  MemberSchema,
  ProjectSchema,
  SuccessResponseSchema,
  type ErrorResponse,
  type ProjectDTO,
} from "@/contracts";
import { getEnv, parseEnv } from "@/server/env";
import { REQUEST_ID_HEADER } from "@/server/http/request-id";

/**
 * `/api/v1/projects*` 集成测试（M2 / ORB-007：项目 CRUD、授权、幂等、配额、分页）。
 *
 * 与 me.test.ts 同一套基础设施：在**独立测试库 orbit_test**（TEST_DATABASE_URL）上，
 * 直接调用 Next.js route handler（纯 `(Request, ctx?) => Response` 函数），覆盖真实路由编排
 * （请求 ID → Origin → 会话 → schema → 领域服务 → 信封）而不启 HTTP 服务。
 *
 * ⚠️ 单例隔离（必须在动态 import 前）：
 *  - `vi.mock("@/server/db/prisma")` 把应用 Prisma 单例换成绑定 TEST_DATABASE_URL 的客户端，
 *    handler 与领域服务因此读写 orbit_test，绝不触碰 orbit_dev；
 *  - `APP_ENV="test"` 关闭 Better Auth 内置限流（本文件多次 getSession）；
 *  - 会话夹具用**同一个** auth 单例签发 cookie，handler 内部 getSession 才能解出会话。
 *
 * 覆盖场景（docs/01 §4 权限矩阵/配额、docs/04 §3/§4、docs/05 §4/§5/§6）：
 *  创建 201 / 非成员 404 / key 重复 409 / owner 改 version++ / member 改 403 /
 *  expectedVersion 不符 409+currentVersion / 归档只读 409 / 恢复配额 / 超 10 项目 422 /
 *  幂等同 key 同 body 重放 200 / 同 key 异 body 409 / 列表分页 / 成员列表。
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
 * 连接池 max=15：给并发/多事务留出余量，避免池打满导致的技术性失败掩盖业务断言。
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
const { auth } = await import("@/server/auth");
const { prisma: testPrisma } = await import("@/server/db/prisma");

/* ── 夹具常量 ─────────────────────────────────────────────────────────── */

const RUN_TAG = `orb007-${Date.now()}`;
const domain = "orbit.test";
const EMAIL_A = `${RUN_TAG}-a@${domain}`; // 主账户：项目 owner
const EMAIL_B = `${RUN_TAG}-b@${domain}`; // 对照账户：成员 / 非成员 / 分页 owner
const EMAIL_C = `${RUN_TAG}-c@${domain}`; // 配额账户：LIMIT_EXCEEDED / 恢复配额
const PASSWORD = "Str0ng!Passw0rd-OrbitTest";
const NAME_A = "项目主";
const NAME_B = "成员乙";
const NAME_C = "配额丙";

const BASE = `${env.BETTER_AUTH_URL}/api/v1`;
const TRUSTED_ORIGIN =
  env.AUTH_TRUSTED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0] ?? env.BETTER_AUTH_URL;

/** key 前缀：run 唯一（base36 时间戳后 4 位），确保跨运行不撞 DB 全局唯一约束。 */
const KEY_PREFIX = `T${Date.now().toString(36).slice(-4).toUpperCase()}`;
let keyCounter = 0;
/** 生成合法且本次运行内唯一的项目 key（`/^[A-Z][A-Z0-9]{1,7}$/`，≤8 位）。 */
function nextKey(): string {
  keyCounter += 1;
  return `${KEY_PREFIX}${String(keyCounter).padStart(2, "0")}`.slice(0, 8);
}

/* ── 信封校验器（strict，形状不合契约直接抛错）────────────────────────── */
const ProjectSuccess = SuccessResponseSchema(ProjectSchema);
const ProjectListSuccess = ListResponseSchema(ProjectSchema);
const MemberListSuccess = SuccessResponseSchema(z.array(MemberSchema));

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

/** 动态段上下文（Next.js 16：params 为 Promise）。 */
function ctx(projectId: string): { params: Promise<{ projectId: string }> } {
  return { params: Promise.resolve({ projectId }) };
}

async function readError(response: Response): Promise<ErrorResponse> {
  return ErrorResponseSchema.parse((await response.json()) as unknown);
}

/** POST /projects 创建并断言 201，返回 ProjectDTO。 */
async function createOk(
  cookie: string,
  input: { name: string; key?: string; description?: string; color?: string },
  idempotencyKey: string = randomUUID(),
): Promise<{ project: ProjectDTO; idempotencyKey: string }> {
  const body = { name: input.name, key: input.key ?? nextKey(), ...(input.description !== undefined ? { description: input.description } : {}), ...(input.color !== undefined ? { color: input.color } : {}) };
  const response = await projectsRoute.POST(
    buildRequest("POST", `${BASE}/projects`, { cookie, body, idempotencyKey }),
  );
  expect(response.status).toBe(201);
  const parsed = ProjectSuccess.parse((await response.json()) as unknown);
  return { project: parsed.data, idempotencyKey };
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
 * 每个用例后重置项目数据（保留用户/会话），使各用例彼此隔离：
 * 否则 A 跨用例累计创建会撞上 MAX_ACTIVE_PROJECTS(10) 配额，令后续创建误报 422。
 * 按 FK onDelete:Restrict 的 子→父 顺序删除。
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
  await testPrisma.projectMember.deleteMany({
    where: { OR: [{ projectId: { in: projectIds } }, { userId: { in: userIds } }] },
  });
  await testPrisma.project.deleteMany({ where: { id: { in: projectIds } } });
});

afterAll(async () => {
  await cleanup();
  await testPrisma.$disconnect();
});

/* ── 1. POST /projects：创建 / 幂等 / key 冲突 ─────────────────────────── */

describe("POST /projects：创建与幂等", () => {
  it("创建成功 → 201 + 合法 ProjectDTO（owner=当前用户、version=1、role=OWNER）", async () => {
    const key = nextKey();
    const response = await projectsRoute.POST(
      buildRequest("POST", `${BASE}/projects`, {
        cookie: cookieA,
        body: { name: "  轨道项目  ", key, description: "  描述  ", color: "TEAL" },
        idempotencyKey: randomUUID(),
      }),
    );
    expect(response.status).toBe(201);
    const { data } = ProjectSuccess.parse((await response.json()) as unknown);
    expect(data).toMatchObject({
      name: "轨道项目", // 服务端 trim
      key,
      description: "描述",
      color: "TEAL",
      ownerId: userAId,
      role: "OWNER",
      version: 1,
      boardVersion: 1,
      memberCount: 1,
      openTaskCount: 0,
      archivedAt: null,
    });
    // 落库校验：Project 行 + PROJECT_CREATED 活动（业务与活动同事务）。
    const row = await testPrisma.project.findUniqueOrThrow({ where: { id: data.id } });
    expect(row.ownerId).toBe(userAId);
    const activity = await testPrisma.activityLog.findFirst({
      where: { projectId: data.id, action: "PROJECT_CREATED" },
    });
    expect(activity).not.toBeNull();
    expect(activity?.actorId).toBe(userAId);
  });

  it("未提供 color → 默认 BLUE；未提供 description → 空串", async () => {
    const { project } = await createOk(cookieA, { name: "默认色项目" });
    expect(project.color).toBe("BLUE");
    expect(project.description).toBe("");
  });

  it("缺少 Idempotency-Key → 400 VALIDATION_ERROR", async () => {
    const response = await projectsRoute.POST(
      buildRequest("POST", `${BASE}/projects`, {
        cookie: cookieA,
        body: { name: "无幂等键", key: nextKey() },
      }),
    );
    expect(response.status).toBe(400);
    expect((await readError(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("幂等：同 key 同 body 重放 → 200 原结果（同一项目 id，不重复创建）", async () => {
    const idempotencyKey = randomUUID();
    const key = nextKey();
    const body = { name: "幂等项目", key };
    const first = await projectsRoute.POST(
      buildRequest("POST", `${BASE}/projects`, { cookie: cookieA, body, idempotencyKey }),
    );
    expect(first.status).toBe(201);
    const firstData = ProjectSuccess.parse((await first.json()) as unknown).data;

    const second = await projectsRoute.POST(
      buildRequest("POST", `${BASE}/projects`, { cookie: cookieA, body, idempotencyKey }),
    );
    expect(second.status).toBe(200); // 重放 200，非 201
    const secondData = ProjectSuccess.parse((await second.json()) as unknown).data;
    expect(secondData.id).toBe(firstData.id);

    const count = await testPrisma.project.count({ where: { key } });
    expect(count).toBe(1);
  });

  it("幂等：同 key 异 body → 409 IDEMPOTENCY_CONFLICT", async () => {
    const idempotencyKey = randomUUID();
    const first = await projectsRoute.POST(
      buildRequest("POST", `${BASE}/projects`, {
        cookie: cookieA,
        body: { name: "冲突甲", key: nextKey() },
        idempotencyKey,
      }),
    );
    expect(first.status).toBe(201);

    const second = await projectsRoute.POST(
      buildRequest("POST", `${BASE}/projects`, {
        cookie: cookieA,
        body: { name: "冲突乙", key: nextKey() },
        idempotencyKey,
      }),
    );
    expect(second.status).toBe(409);
    expect((await readError(second)).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("key 重复 → 409 PROJECT_KEY_TAKEN", async () => {
    const key = nextKey();
    await createOk(cookieA, { name: "首个占用", key });
    const response = await projectsRoute.POST(
      buildRequest("POST", `${BASE}/projects`, {
        cookie: cookieA,
        body: { name: "重复 key", key },
        idempotencyKey: randomUUID(),
      }),
    );
    expect(response.status).toBe(409);
    expect((await readError(response)).error.code).toBe("PROJECT_KEY_TAKEN");
  });

  it("非法 Origin → 403 ORIGIN_NOT_ALLOWED（写操作先验 Origin）", async () => {
    const response = await projectsRoute.POST(
      buildRequest("POST", `${BASE}/projects`, {
        cookie: cookieA,
        body: { name: "跨源", key: nextKey() },
        idempotencyKey: randomUUID(),
        origin: "https://evil.example",
      }),
    );
    expect(response.status).toBe(403);
    expect((await readError(response)).error.code).toBe("ORIGIN_NOT_ALLOWED");
  });
});

/* ── 2. GET /projects/{id}：授权可见性 ─────────────────────────────────── */

describe("GET /projects/{projectId}：授权可见性", () => {
  it("owner 读取 → 200 + role=OWNER", async () => {
    const { project } = await createOk(cookieA, { name: "可读项目" });
    const response = await projectRoute.GET(
      buildRequest("GET", `${BASE}/projects/${project.id}`, { cookie: cookieA }),
      ctx(project.id),
    );
    expect(response.status).toBe(200);
    const data = ProjectSuccess.parse((await response.json()) as unknown).data;
    expect(data.id).toBe(project.id);
    expect(data.role).toBe("OWNER");
  });

  it("非成员读取他人项目 → 404 NOT_FOUND（不区分不存在与不可见）", async () => {
    const { project } = await createOk(cookieA, { name: "A 的私有项目" });
    const response = await projectRoute.GET(
      buildRequest("GET", `${BASE}/projects/${project.id}`, { cookie: cookieB }),
      ctx(project.id),
    );
    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("NOT_FOUND");
  });

  it("不存在的 UUID → 404 NOT_FOUND", async () => {
    const missing = randomUUID();
    const response = await projectRoute.GET(
      buildRequest("GET", `${BASE}/projects/${missing}`, { cookie: cookieA }),
      ctx(missing),
    );
    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("NOT_FOUND");
  });

  it("成员读取 → 200 + role=MEMBER（memberCount 含 owner+成员）", async () => {
    const { project } = await createOk(cookieA, { name: "有成员项目" });
    await testPrisma.projectMember.create({
      data: { projectId: project.id, userId: userBId },
    });
    const response = await projectRoute.GET(
      buildRequest("GET", `${BASE}/projects/${project.id}`, { cookie: cookieB }),
      ctx(project.id),
    );
    expect(response.status).toBe(200);
    const data = ProjectSuccess.parse((await response.json()) as unknown).data;
    expect(data.role).toBe("MEMBER");
    expect(data.memberCount).toBe(2);
  });
});

/* ── 3. PATCH /projects/{id}：更新 / 版本 / 归档 / 成员权限 ─────────────── */

describe("PATCH /projects/{projectId}：更新与并发控制", () => {
  it("owner 改名 → 200 + version++ + 写 PROJECT_UPDATED 活动（含 fields）", async () => {
    const { project } = await createOk(cookieA, { name: "旧名字" });
    const response = await projectRoute.PATCH(
      buildRequest("PATCH", `${BASE}/projects/${project.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 1, name: "新名字" },
      }),
      ctx(project.id),
    );
    expect(response.status).toBe(200);
    const data = ProjectSuccess.parse((await response.json()) as unknown).data;
    expect(data.name).toBe("新名字");
    expect(data.version).toBe(2);

    const activity = await testPrisma.activityLog.findFirst({
      where: { projectId: project.id, action: "PROJECT_UPDATED" },
    });
    expect(activity).not.toBeNull();
    expect((activity?.metadata as { fields?: string[] }).fields).toContain("name");
  });

  it("规范化后无语义变化（改成 trim 后同值）→ 200 但不 bump version、不写活动", async () => {
    const { project } = await createOk(cookieA, { name: "稳定名" });
    const before = await testPrisma.activityLog.count({ where: { projectId: project.id } });
    const response = await projectRoute.PATCH(
      buildRequest("PATCH", `${BASE}/projects/${project.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 1, name: "  稳定名  " },
      }),
      ctx(project.id),
    );
    expect(response.status).toBe(200);
    const data = ProjectSuccess.parse((await response.json()) as unknown).data;
    expect(data.version).toBe(1); // 未 bump
    const after = await testPrisma.activityLog.count({ where: { projectId: project.id } });
    expect(after).toBe(before); // 未新增活动
  });

  it("expectedVersion 不符 → 409 VERSION_CONFLICT + currentVersion", async () => {
    const { project } = await createOk(cookieA, { name: "版本冲突项目" });
    const response = await projectRoute.PATCH(
      buildRequest("PATCH", `${BASE}/projects/${project.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 99, name: "改名" },
      }),
      ctx(project.id),
    );
    expect(response.status).toBe(409);
    const envelope = await readError(response);
    expect(envelope.error.code).toBe("VERSION_CONFLICT");
    expect(envelope.error.currentVersion).toBe(1);
  });

  it("member 修改项目 → 403 FORBIDDEN（owner-only）", async () => {
    const { project } = await createOk(cookieA, { name: "成员禁改" });
    await testPrisma.projectMember.create({
      data: { projectId: project.id, userId: userBId },
    });
    const response = await projectRoute.PATCH(
      buildRequest("PATCH", `${BASE}/projects/${project.id}`, {
        cookie: cookieB,
        body: { expectedVersion: 1, name: "成员改名" },
      }),
      ctx(project.id),
    );
    expect(response.status).toBe(403);
    expect((await readError(response)).error.code).toBe("FORBIDDEN");
  });

  it("归档项目 → 200 + archivedAt 非空 + PROJECT_ARCHIVED 活动；随后写操作 → 409 PROJECT_ARCHIVED", async () => {
    const { project } = await createOk(cookieA, { name: "待归档" });
    const archiveRes = await projectRoute.PATCH(
      buildRequest("PATCH", `${BASE}/projects/${project.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 1, archived: true },
      }),
      ctx(project.id),
    );
    expect(archiveRes.status).toBe(200);
    const archived = ProjectSuccess.parse((await archiveRes.json()) as unknown).data;
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.version).toBe(2);
    const archActivity = await testPrisma.activityLog.findFirst({
      where: { projectId: project.id, action: "PROJECT_ARCHIVED" },
    });
    expect(archActivity).not.toBeNull();

    // 归档后改名 → 只读 409。
    const writeRes = await projectRoute.PATCH(
      buildRequest("PATCH", `${BASE}/projects/${project.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 2, name: "归档后改名" },
      }),
      ctx(project.id),
    );
    expect(writeRes.status).toBe(409);
    expect((await readError(writeRes)).error.code).toBe("PROJECT_ARCHIVED");
  });

  it("owner 恢复归档（配额充足）→ 200 + archivedAt=null + PROJECT_RESTORED 活动", async () => {
    const { project } = await createOk(cookieA, { name: "待恢复" });
    await projectRoute.PATCH(
      buildRequest("PATCH", `${BASE}/projects/${project.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 1, archived: true },
      }),
      ctx(project.id),
    );
    const restoreRes = await projectRoute.PATCH(
      buildRequest("PATCH", `${BASE}/projects/${project.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 2, archived: false },
      }),
      ctx(project.id),
    );
    expect(restoreRes.status).toBe(200);
    const restored = ProjectSuccess.parse((await restoreRes.json()) as unknown).data;
    expect(restored.archivedAt).toBeNull();
    expect(restored.version).toBe(3);
    const activity = await testPrisma.activityLog.findFirst({
      where: { projectId: project.id, action: "PROJECT_RESTORED" },
    });
    expect(activity).not.toBeNull();
  });
});

/* ── 4. 配额：LIMIT_EXCEEDED（创建 + 恢复）────────────────────────────── */

describe("配额：未归档项目数上限（MAX_ACTIVE_PROJECTS=10）", () => {
  it("第 11 个未归档项目 → 422 LIMIT_EXCEEDED；归档一个后恢复超配额 → 422", async () => {
    // 用独立账户 C，避免与其它用例的项目计数相互干扰。
    const created: ProjectDTO[] = [];
    for (let i = 0; i < 10; i += 1) {
      const { project } = await createOk(cookieC, { name: `配额项目 ${i}` });
      created.push(project);
    }
    expect(created).toHaveLength(10);

    // 第 11 个 → 422。
    const overflow = await projectsRoute.POST(
      buildRequest("POST", `${BASE}/projects`, {
        cookie: cookieC,
        body: { name: "超额项目", key: nextKey() },
        idempotencyKey: randomUUID(),
      }),
    );
    expect(overflow.status).toBe(422);
    expect((await readError(overflow)).error.code).toBe("LIMIT_EXCEEDED");

    // 归档 created[0] → 9 active + 1 archived。
    const archiveRes = await projectRoute.PATCH(
      buildRequest("PATCH", `${BASE}/projects/${created[0]!.id}`, {
        cookie: cookieC,
        body: { expectedVersion: 1, archived: true },
      }),
      ctx(created[0]!.id),
    );
    expect(archiveRes.status).toBe(200);

    // 补一个到 10 active（仍 1 archived）。
    await createOk(cookieC, { name: "补位项目" });

    // 恢复归档项目 → 已满 10 → 422 LIMIT_EXCEEDED（保留归档态）。
    const restoreRes = await projectRoute.PATCH(
      buildRequest("PATCH", `${BASE}/projects/${created[0]!.id}`, {
        cookie: cookieC,
        body: { expectedVersion: 2, archived: false },
      }),
      ctx(created[0]!.id),
    );
    expect(restoreRes.status).toBe(422);
    expect((await readError(restoreRes)).error.code).toBe("LIMIT_EXCEEDED");

    // 事务回滚：该项目仍为归档态。
    const stillArchived = await testPrisma.project.findUniqueOrThrow({
      where: { id: created[0]!.id },
    });
    expect(stillArchived.archivedAt).not.toBeNull();
    expect(stillArchived.version).toBe(2); // 未 bump
  }, 60_000);
});

/* ── 5. GET /projects：列表与游标分页 ─────────────────────────────────── */

describe("GET /projects：列表与游标分页", () => {
  it("scope=owned + limit 分页：hasMore/nextCursor 正确，翻页无重叠", async () => {
    // B 独立拥有 4 个项目，避免与 A 的数据混淆。
    for (let i = 0; i < 4; i += 1) {
      await createOk(cookieB, { name: `分页项目 ${i}` });
    }

    const page1Res = await projectsRoute.GET(
      buildRequest("GET", `${BASE}/projects?scope=owned&limit=2`, { cookie: cookieB }),
    );
    expect(page1Res.status).toBe(200);
    const page1 = ProjectListSuccess.parse((await page1Res.json()) as unknown);
    expect(page1.data).toHaveLength(2);
    expect(page1.meta.hasMore).toBe(true);
    expect(page1.meta.nextCursor).not.toBeNull();
    // 默认 archived=exclude：全部未归档。
    expect(page1.data.every((p) => p.archivedAt === null)).toBe(true);
    expect(page1.data.every((p) => p.ownerId === userBId || p.role === "OWNER")).toBe(true);

    const page2Res = await projectsRoute.GET(
      buildRequest(
        "GET",
        `${BASE}/projects?scope=owned&limit=2&cursor=${encodeURIComponent(page1.meta.nextCursor!)}`,
        { cookie: cookieB },
      ),
    );
    expect(page2Res.status).toBe(200);
    const page2 = ProjectListSuccess.parse((await page2Res.json()) as unknown);
    expect(page2.data).toHaveLength(2);
    // 两页 id 无重叠（keyset 分页正确性）。
    const ids1 = new Set(page1.data.map((p) => p.id));
    expect(page2.data.some((p) => ids1.has(p.id))).toBe(false);
  }, 30_000);

  it("archived=only 只返回已归档项目", async () => {
    const { project } = await createOk(cookieA, { name: "将被归档以过滤" });
    await projectRoute.PATCH(
      buildRequest("PATCH", `${BASE}/projects/${project.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 1, archived: true },
      }),
      ctx(project.id),
    );
    const response = await projectsRoute.GET(
      buildRequest("GET", `${BASE}/projects?scope=owned&archived=only`, { cookie: cookieA }),
    );
    expect(response.status).toBe(200);
    const list = ProjectListSuccess.parse((await response.json()) as unknown);
    expect(list.data.length).toBeGreaterThan(0);
    expect(list.data.every((p) => p.archivedAt !== null)).toBe(true);
    expect(list.data.some((p) => p.id === project.id)).toBe(true);
  });

  it("损坏的 cursor → 400（INVALID_CURSOR / VALIDATION_ERROR）", async () => {
    const response = await projectsRoute.GET(
      buildRequest("GET", `${BASE}/projects?cursor=%E4%B8%8D%E6%98%AF%E5%90%88%E6%B3%95%E6%B8%B8%E6%A0%87`, {
        cookie: cookieA,
      }),
    );
    expect(response.status).toBe(400);
  });
});

/* ── 6. GET /projects/{id}/members：成员列表 ──────────────────────────── */

describe("GET /projects/{projectId}/members：成员列表", () => {
  it("返回 owner（首位, role=OWNER）+ 成员（role=MEMBER），不含 email", async () => {
    const { project } = await createOk(cookieA, { name: "成员列表项目" });
    await testPrisma.projectMember.create({
      data: { projectId: project.id, userId: userBId },
    });
    const response = await membersRoute.GET(
      buildRequest("GET", `${BASE}/projects/${project.id}/members`, { cookie: cookieA }),
      ctx(project.id),
    );
    expect(response.status).toBe(200);
    const parsed = MemberListSuccess.parse((await response.json()) as unknown);
    expect(parsed.data).toHaveLength(2);
    expect(parsed.data[0]).toMatchObject({ userId: userAId, role: "OWNER", name: NAME_A });
    expect(parsed.data[1]).toMatchObject({ userId: userBId, role: "MEMBER", name: NAME_B });
    // 不向队友披露 email（docs/05 §4）。
    expect(JSON.stringify(parsed.data)).not.toContain(EMAIL_A);
    expect(JSON.stringify(parsed.data)).not.toContain(EMAIL_B);
  });

  it("非成员列出成员 → 404 NOT_FOUND", async () => {
    const { project } = await createOk(cookieA, { name: "成员不可见项目" });
    // 用第三个账户 C（非该项目成员）访问。
    const response = await membersRoute.GET(
      buildRequest("GET", `${BASE}/projects/${project.id}/members`, { cookie: cookieC }),
      ctx(project.id),
    );
    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("NOT_FOUND");
  });
});
