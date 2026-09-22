import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ErrorResponseSchema,
  MemberSchema,
  ProjectSchema,
  SuccessResponseSchema,
  TaskSchema,
  type ErrorResponse,
  type MemberDTO,
  type ProjectDTO,
  type TaskDTO,
} from "@/contracts";
import { getEnv, parseEnv } from "@/server/env";

/**
 * M4 / ORB-014：成员管理纵向闭环集成验证（members）。
 *
 * 与 activity.test.ts / permission.test.ts 同一套基础设施：在**独立测试库 orbit_test**
 * （TEST_DATABASE_URL）上直接调用 Next.js route handler，覆盖真实路由编排。
 *
 * 覆盖 AC-09：列成员（happy / 非成员 404）、owner 移除成员（清任务分配 + version++ +
 * MEMBER_REMOVED 活动 + 含软删除任务）、成员自我退出、不可移除 owner（403）、
 * 普通成员不可移除他人（403）、移除不存在成员（404）、并发「移除 + 分配」竞态安全。
 *
 * ⚠️ 授权约定（src/server/services/member.service.ts + docs/03 §5、docs/05 §3）：
 *  - 非成员/项目不存在统一 **404 NOT_FOUND**（不泄露存在性，绝不 403）；
 *  - 成员执行越权写（移除他人 / 移除 owner）→ **403 FORBIDDEN**。
 *
 * ⚠️ 单例隔离（必须在动态 import 前）：vi.mock 绑定 TEST_DATABASE_URL + APP_ENV=test。
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);

/** 仅供测试的固定密钥（≥32），非任何真实凭证。 */
const TEST_SECRET = "orbit-integration-members-test-secret-0123456789";

/* ── 环境覆写：关闭限流 + 固定测试密钥（必须在动态 import 前）────────────── */
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

/* ── 动态 import（必须在环境覆写与 vi.mock 注册之后）────────────────────── */
const projectsRoute = await import("@/app/api/v1/projects/route");
const tasksRoute = await import("@/app/api/v1/projects/[projectId]/tasks/route");
const taskRoute = await import("@/app/api/v1/tasks/[taskId]/route");
const membersRoute = await import("@/app/api/v1/projects/[projectId]/members/route");
const memberRoute = await import("@/app/api/v1/projects/[projectId]/members/[userId]/route");
const { auth } = await import("@/server/auth");
const { prisma: testPrisma } = await import("@/server/db/prisma");

/* ── 夹具常量 ─────────────────────────────────────────────────────────── */

const RUN_TAG = `mbr-${Date.now()}`;
const domain = "orbit.test";
const EMAIL_A = `${RUN_TAG}-a@${domain}`; // 项目 owner
const EMAIL_B = `${RUN_TAG}-b@${domain}`; // 成员 B
const EMAIL_C = `${RUN_TAG}-c@${domain}`; // 成员 C
const EMAIL_D = `${RUN_TAG}-d@${domain}`; // 局外用户（非成员）
const PASSWORD = "IntegrationMember!Pass0rd";
const NAME_A = "成员所有者";
const NAME_B = "成员乙";
const NAME_C = "成员丙";
const NAME_D = "局外丁";

const BASE = `${env.BETTER_AUTH_URL}/api/v1`;
const TRUSTED_ORIGIN =
  env.AUTH_TRUSTED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0] ?? env.BETTER_AUTH_URL;

const KEY_PREFIX = `M${Date.now().toString(36).slice(-4).toUpperCase()}`;
let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `${KEY_PREFIX}${String(keyCounter).padStart(2, "0")}`.slice(0, 8);
}

/* ── 信封校验器（strict）───────────────────────────────────────────────── */
const ProjectSuccess = SuccessResponseSchema(ProjectSchema);
const TaskSuccess = SuccessResponseSchema(TaskSchema);
const MemberListSuccess = SuccessResponseSchema(z.array(MemberSchema));

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

function ctxTask(taskId: string): { params: Promise<{ taskId: string }> } {
  return { params: Promise.resolve({ taskId }) };
}

function ctxMember(
  projectId: string,
  userId: string,
): { params: Promise<{ projectId: string; userId: string }> } {
  return { params: Promise.resolve({ projectId, userId }) };
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
let userCId = "";
let userDId = "";

/** 回收本 run 数据（子→父 顺序删除）。 */
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

async function cleanupProjects(): Promise<void> {
  const userIds = [userAId, userBId, userCId, userDId].filter((id) => id.length > 0);
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
  await signUpVerified(EMAIL_C, NAME_C);
  await signUpVerified(EMAIL_D, NAME_D);
  cookieA = await signIn(EMAIL_A);
  cookieB = await signIn(EMAIL_B);
  cookieD = await signIn(EMAIL_D);
  expect(cookieA).toContain("session_token");
  const a = await testPrisma.user.findUniqueOrThrow({ where: { email: EMAIL_A } });
  const b = await testPrisma.user.findUniqueOrThrow({ where: { email: EMAIL_B } });
  const c = await testPrisma.user.findUniqueOrThrow({ where: { email: EMAIL_C } });
  const d = await testPrisma.user.findUniqueOrThrow({ where: { email: EMAIL_D } });
  userAId = a.id;
  userBId = b.id;
  userCId = c.id;
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

/** 直接把某用户加为项目成员；joinedAt 可显式指定以获得确定排序。 */
async function addMember(projectId: string, userId: string, joinedAt?: Date): Promise<void> {
  await testPrisma.projectMember.create({
    data: joinedAt ? { projectId, userId, joinedAt } : { projectId, userId },
  });
}

/** A 在项目内创建任务并断言 201（可带 assigneeId）。 */
async function createTaskOk(
  projectId: string,
  body: Record<string, unknown>,
): Promise<TaskDTO> {
  const response = await tasksRoute.POST(
    buildRequest("POST", `${BASE}/projects/${projectId}/tasks`, {
      cookie: cookieA,
      body,
      idempotencyKey: randomUUID(),
    }),
    ctxProject(projectId),
  );
  expect(response.status).toBe(201);
  return TaskSuccess.parse((await response.json()) as unknown).data;
}

/** A 软删除任务并断言 200。 */
async function softDeleteTaskOk(taskId: string, version: number): Promise<void> {
  const response = await taskRoute.DELETE(
    buildRequest("DELETE", `${BASE}/tasks/${taskId}?expectedVersion=${version}`, {
      cookie: cookieA,
    }),
    ctxTask(taskId),
  );
  expect(response.status).toBe(200);
}

/* ── 1. 列成员（happy path）──────────────────────────────────────────── */

describe("列成员 · happy path", () => {
  it("GET → 200，owner 首位（OWNER）+ 成员按 joinedAt 升序（MEMBER），且不含 email", async () => {
    const project = await createProjectOk("成员列表项目");
    // 显式 joinedAt 保证确定排序：B 早于 C。
    const base = Date.now();
    await addMember(project.id, userBId, new Date(base - 2000));
    await addMember(project.id, userCId, new Date(base - 1000));

    const response = await membersRoute.GET(
      buildRequest("GET", `${BASE}/projects/${project.id}/members`, { cookie: cookieA }),
      ctxProject(project.id),
    );
    expect(response.status).toBe(200);
    const raw = (await response.json()) as unknown;
    const members: MemberDTO[] = MemberListSuccess.parse(raw).data;

    expect(members).toHaveLength(3);
    // owner 排首位、role OWNER。
    expect(members[0]!.userId).toBe(userAId);
    expect(members[0]!.role).toBe("OWNER");
    expect(members[0]!.name).toBe(NAME_A);
    // 其后按 joinedAt 升序：B 先于 C，均 role MEMBER。
    expect(members[1]!.userId).toBe(userBId);
    expect(members[1]!.role).toBe("MEMBER");
    expect(members[2]!.userId).toBe(userCId);
    expect(members[2]!.role).toBe("MEMBER");
    // 每条仅含契约字段（userId/name/role/joinedAt），无 email。
    for (const m of members) {
      expect(Object.keys(m).sort()).toEqual(["joinedAt", "name", "role", "userId"]);
    }
    expect(JSON.stringify(raw)).not.toContain(domain);
  });

  it("成员本人 GET → 200（成员可见）", async () => {
    const project = await createProjectOk("成员列表项目 · 成员可见");
    await addMember(project.id, userBId);
    const response = await membersRoute.GET(
      buildRequest("GET", `${BASE}/projects/${project.id}/members`, { cookie: cookieB }),
      ctxProject(project.id),
    );
    expect(response.status).toBe(200);
    const members = MemberListSuccess.parse((await response.json()) as unknown).data;
    expect(members.map((m) => m.userId).sort()).toEqual([userAId, userBId].sort());
  });
});

/* ── 2. 列成员（非成员 → 404）────────────────────────────────────────── */

describe("列成员 · 授权", () => {
  it("非成员 GET → 404 NOT_FOUND（不是 403）", async () => {
    const project = await createProjectOk("成员列表项目 · 非成员");
    const response = await membersRoute.GET(
      buildRequest("GET", `${BASE}/projects/${project.id}/members`, { cookie: cookieD }),
      ctxProject(project.id),
    );
    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("NOT_FOUND");
  });

  it("未认证 GET → 401 UNAUTHENTICATED", async () => {
    const project = await createProjectOk("成员列表项目 · 未认证");
    const response = await membersRoute.GET(
      buildRequest("GET", `${BASE}/projects/${project.id}/members`, { cookie: null }),
      ctxProject(project.id),
    );
    expect(response.status).toBe(401);
    expect((await readError(response)).error.code).toBe("UNAUTHENTICATED");
  });
});

/* ── 3. owner 移除成员 ───────────────────────────────────────────────── */

describe("owner 移除成员", () => {
  it("DELETE → 204，成员删除、其任务（含软删除）分配清空且 version++，写 MEMBER_REMOVED 活动", async () => {
    const project = await createProjectOk("移除成员项目");
    await addMember(project.id, userBId);
    await addMember(project.id, userCId);

    // B 名下两个任务：一个活跃、一个软删除。
    const activeTask = await createTaskOk(project.id, { title: "B 的活跃任务", assigneeId: userBId });
    const deletedTask = await createTaskOk(project.id, { title: "B 的待删任务", assigneeId: userBId });
    await softDeleteTaskOk(deletedTask.id, deletedTask.version);

    // 移除前读取真实 version（活跃=1；软删除后=2）。
    const activeBefore = await testPrisma.task.findUniqueOrThrow({
      where: { id: activeTask.id },
      select: { version: true, assigneeId: true },
    });
    const deletedBefore = await testPrisma.task.findUniqueOrThrow({
      where: { id: deletedTask.id },
      select: { version: true, assigneeId: true, deletedAt: true },
    });
    expect(activeBefore.assigneeId).toBe(userBId);
    expect(deletedBefore.assigneeId).toBe(userBId);
    expect(deletedBefore.deletedAt).toBeTruthy();

    const response = await memberRoute.DELETE(
      buildRequest("DELETE", `${BASE}/projects/${project.id}/members/${userBId}`, {
        cookie: cookieA,
      }),
      ctxMember(project.id, userBId),
    );
    expect(response.status).toBe(204);

    // 成员记录删除。
    expect(
      await testPrisma.projectMember.count({
        where: { projectId: project.id, userId: userBId },
      }),
    ).toBe(0);
    // C 不受影响。
    expect(
      await testPrisma.projectMember.count({
        where: { projectId: project.id, userId: userCId },
      }),
    ).toBe(1);

    // 两个任务的分配均被清空、version 递增（含软删除任务）。
    const activeAfter = await testPrisma.task.findUniqueOrThrow({
      where: { id: activeTask.id },
      select: { version: true, assigneeId: true },
    });
    expect(activeAfter.assigneeId).toBeNull();
    expect(activeAfter.version).toBe(activeBefore.version + 1);

    const deletedAfter = await testPrisma.task.findUniqueOrThrow({
      where: { id: deletedTask.id },
      select: { version: true, assigneeId: true, deletedAt: true },
    });
    expect(deletedAfter.assigneeId).toBeNull();
    expect(deletedAfter.version).toBe(deletedBefore.version + 1);
    expect(deletedAfter.deletedAt).toBeTruthy(); // 仍保持软删除态

    // 活动：MEMBER_REMOVED，actor=A，entityId=MembershipID（不是 userId），metadata.count=2（清理了两条任务分配）。
    const activity = await testPrisma.activityLog.findFirstOrThrow({
      where: { projectId: project.id, action: "MEMBER_REMOVED", actorId: userAId },
    });
    expect(activity.entityType).toBe("MEMBER");
    // entityId 现在是 MembershipRecord 的 UUID（不是 targetUserId）
    expect(activity.entityId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const meta = activity.metadata as Record<string, unknown>;
    expect(meta.targetUserId).toBe(userBId);
    expect(meta.count).toBe(2);
  });
});

/* ── 4. 成员自我退出 ─────────────────────────────────────────────────── */

describe("成员自我退出", () => {
  it("成员 DELETE 自身 → 204，成员移除、其任务分配清空", async () => {
    const project = await createProjectOk("自我退出项目");
    await addMember(project.id, userBId);
    const task = await createTaskOk(project.id, { title: "B 的任务", assigneeId: userBId });

    const response = await memberRoute.DELETE(
      buildRequest("DELETE", `${BASE}/projects/${project.id}/members/${userBId}`, {
        cookie: cookieB,
      }),
      ctxMember(project.id, userBId),
    );
    expect(response.status).toBe(204);

    expect(
      await testPrisma.projectMember.count({
        where: { projectId: project.id, userId: userBId },
      }),
    ).toBe(0);
    const after = await testPrisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { assigneeId: true, version: true },
    });
    expect(after.assigneeId).toBeNull();
    expect(after.version).toBe(task.version + 1);

    // ❌ R08-3 FIX: Self-exit should log MEMBER_LEFT (voluntary departure)
    const activity = await testPrisma.activityLog.findFirst({
      where: { projectId: project.id, actorId: userBId },
    });
    expect(activity?.action).toBe("MEMBER_LEFT");
    expect(activity?.entityType).toBe("MEMBER");
    expect(activity?.metadata as Record<string, unknown>).toMatchObject({ targetUserId: userBId, count: 1 });
  });
});

/* ── 5. 不可移除 owner ───────────────────────────────────────────────── */

describe("不可移除项目所有者", () => {
  it("owner 试图移除自己（owner）→ 403 FORBIDDEN", async () => {
    const project = await createProjectOk("不可移除 owner 项目");
    const response = await memberRoute.DELETE(
      buildRequest("DELETE", `${BASE}/projects/${project.id}/members/${userAId}`, {
        cookie: cookieA,
      }),
      ctxMember(project.id, userAId),
    );
    expect(response.status).toBe(403);
    expect((await readError(response)).error.code).toBe("FORBIDDEN");
  });

  it("成员试图移除 owner → 403 FORBIDDEN", async () => {
    const project = await createProjectOk("不可移除 owner 项目 · 成员发起");
    await addMember(project.id, userBId);
    const response = await memberRoute.DELETE(
      buildRequest("DELETE", `${BASE}/projects/${project.id}/members/${userAId}`, {
        cookie: cookieB,
      }),
      ctxMember(project.id, userAId),
    );
    expect(response.status).toBe(403);
    expect((await readError(response)).error.code).toBe("FORBIDDEN");
  });
});

/* ── 6. 普通成员不可移除他人 ─────────────────────────────────────────── */

describe("普通成员不可移除他人", () => {
  it("成员 B DELETE 成员 C → 403 FORBIDDEN，C 仍是成员", async () => {
    const project = await createProjectOk("成员越权移除项目");
    await addMember(project.id, userBId);
    await addMember(project.id, userCId);

    const response = await memberRoute.DELETE(
      buildRequest("DELETE", `${BASE}/projects/${project.id}/members/${userCId}`, {
        cookie: cookieB,
      }),
      ctxMember(project.id, userCId),
    );
    expect(response.status).toBe(403);
    expect((await readError(response)).error.code).toBe("FORBIDDEN");

    expect(
      await testPrisma.projectMember.count({
        where: { projectId: project.id, userId: userCId },
      }),
    ).toBe(1);
  });
});

/* ── 7. 移除不存在的成员 ─────────────────────────────────────────────── */

describe("移除不存在成员", () => {
  it("owner DELETE 随机 userId → 404 NOT_FOUND", async () => {
    const project = await createProjectOk("移除不存在成员项目");
    const response = await memberRoute.DELETE(
      buildRequest("DELETE", `${BASE}/projects/${project.id}/members/${randomUUID()}`, {
        cookie: cookieA,
      }),
      ctxMember(project.id, randomUUID()),
    );
    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("NOT_FOUND");
  });

  it("非成员请求者 DELETE → 404 NOT_FOUND（请求者非成员优先收敛为 404）", async () => {
    const project = await createProjectOk("移除不存在成员项目 · 非成员发起");
    await addMember(project.id, userBId);
    const response = await memberRoute.DELETE(
      buildRequest("DELETE", `${BASE}/projects/${project.id}/members/${userBId}`, {
        cookie: cookieD,
      }),
      ctxMember(project.id, userBId),
    );
    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("NOT_FOUND");
  });
});

/* ── 8. 并发「移除 + 分配」竞态 ──────────────────────────────────────── */

describe("并发移除 + 分配竞态", () => {
  it("同时移除 B 与给 B 建任务 → 无 500、B 终为非成员、绝无任务遗留给非成员 B", async () => {
    const project = await createProjectOk("并发移除分配项目");
    await addMember(project.id, userBId);

    // 两操作均由 owner A 发起，均在事务内持 Project 行锁 → 串行化。
    const [removeRes, createRes] = await Promise.all([
      memberRoute.DELETE(
        buildRequest("DELETE", `${BASE}/projects/${project.id}/members/${userBId}`, {
          cookie: cookieA,
        }),
        ctxMember(project.id, userBId),
      ),
      tasksRoute.POST(
        buildRequest("POST", `${BASE}/projects/${project.id}/tasks`, {
          cookie: cookieA,
          body: { title: "并发分配给 B 的任务", assigneeId: userBId },
          idempotencyKey: randomUUID(),
        }),
        ctxProject(project.id),
      ),
    ]);

    // 移除恒成功（A 是 owner、B 起始为成员）；建任务成功或被拒（B 已非成员）。
    expect(removeRes.status).toBe(204);
    expect([201, 422]).toContain(createRes.status);
    if (createRes.status === 422) {
      expect((await readError(createRes)).error.code).toBe("ASSIGNEE_NOT_MEMBER");
    }

    // 竞态安全不变量：B 终为非成员，且绝无任务分配遗留给非成员 B。
    expect(
      await testPrisma.projectMember.count({
        where: { projectId: project.id, userId: userBId },
      }),
    ).toBe(0);
    expect(
      await testPrisma.task.count({
        where: { projectId: project.id, assigneeId: userBId },
      }),
    ).toBe(0);
  });
});
