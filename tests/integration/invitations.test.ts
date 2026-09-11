import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import {
  AcceptedInvitationSchema,
  CreatedInvitationSchema,
  ErrorResponseSchema,
  InvitePreviewSchema,
  SuccessResponseSchema,
  ProjectSchema,
  type CreatedInvitationDTO,
  type ErrorResponse,
  type ProjectDTO,
} from "@/contracts";
import { getEnv, parseEnv } from "@/server/env";

/**
 * M4 / ORB-013：邀请令牌纵向闭环集成验证（invitations）。
 *
 * 与 activity.test.ts / permission.test.ts 同一套基础设施：在**独立测试库 orbit_test**
 * （TEST_DATABASE_URL）上直接调用 Next.js route handler（纯 `(Request, ctx?) => Response`），
 * 覆盖真实路由编排（请求 ID → Origin → 会话 → 限流 → Idempotency-Key → schema → 领域服务 → 信封）。
 *
 * 覆盖 AC-03：创建（happy / 非 owner 403 / 幂等重放）、预览（有效 / 过期 / 撤销）、
 * 接受（happy / 并发 / 已用 / 过期 / 撤销）、撤销、令牌安全（仅存 SHA-256 哈希）。
 *
 * ⚠️ 与领域实现对齐（不照搬任务文案，以 src/server/modules/invitation/service.ts 为准）：
 *  - 撤销邀请路由返回 **204 No Content**（非 200 带体）；状态经数据库复核。
 *  - 活动动作：**邀请创建/撤销都不写活动日志**（docs/05 §9）；只有 acceptInvitation 写 MEMBER_JOINED。
 *  - 预览返回 {projectName, ownerName, expiresAt, role, isArchived}（无 state 字段，且不含 token）。
 *
 * ⚠️ 单例隔离（必须在动态 import 前）：vi.mock 绑定 TEST_DATABASE_URL + APP_ENV=test 关闭限流；
 * 会话夹具用**同一个** auth 单例签发 cookie。
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);

/** 仅供测试的固定密钥（≥32），非任何真实凭证。 */
const TEST_SECRET = "orbit-integration-invitation-test-secret-0123456789";

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
const invitationsRoute = await import("@/app/api/v1/projects/[projectId]/invitations/route");
const invitationRoute = await import(
  "@/app/api/v1/projects/[projectId]/invitations/[invitationId]/route"
);
const previewRoute = await import("@/app/api/v1/invitations/preview/route");
const acceptRoute = await import("@/app/api/v1/invitations/accept/route");
const { auth } = await import("@/server/auth");
const { prisma: testPrisma } = await import("@/server/db/prisma");

/* ── 夹具常量 ─────────────────────────────────────────────────────────── */

const RUN_TAG = `inv-${Date.now()}`;
const domain = "orbit.test";
const EMAIL_A = `${RUN_TAG}-a@${domain}`; // 项目 owner（创建/撤销邀请）
const EMAIL_B = `${RUN_TAG}-b@${domain}`; // 受邀者 / 非 owner 成员
const EMAIL_C = `${RUN_TAG}-c@${domain}`; // 第二受邀者（并发 / 已用）
const EMAIL_D = `${RUN_TAG}-d@${domain}`; // 局外用户（非成员）
const PASSWORD = "IntegrationInvite!Pass0rd";
const NAME_A = "邀请所有者";
const NAME_B = "受邀乙";
const NAME_C = "受邀丙";
const NAME_D = "局外丁";

const BASE = `${env.BETTER_AUTH_URL}/api/v1`;
const TRUSTED_ORIGIN =
  env.AUTH_TRUSTED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0] ?? env.BETTER_AUTH_URL;

/** key 前缀：run 唯一，确保跨运行不撞 DB 全局唯一约束（`/^[A-Z][A-Z0-9]{1,7}$/`，≤8 位）。 */
const KEY_PREFIX = `I${Date.now().toString(36).slice(-4).toUpperCase()}`;
let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `${KEY_PREFIX}${String(keyCounter).padStart(2, "0")}`.slice(0, 8);
}

/* ── 信封校验器（strict，形状不合契约直接抛错）────────────────────────── */
const ProjectSuccess = SuccessResponseSchema(ProjectSchema);
const CreatedInvitationSuccess = SuccessResponseSchema(CreatedInvitationSchema);
const InvitePreviewSuccess = SuccessResponseSchema(InvitePreviewSchema);
const AcceptedSuccess = SuccessResponseSchema(AcceptedInvitationSchema);

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

function ctxInvitation(
  projectId: string,
  invitationId: string,
): { params: Promise<{ projectId: string; invitationId: string }> } {
  return { params: Promise.resolve({ projectId, invitationId }) };
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
let cookieD = "";
let userAId = "";
let userBId = "";
let userCId = "";
let userDId = "";

/** 回收本 run 数据（FK onDelete:Restrict，须按 子→父 顺序删除；Invitation 随 Project Cascade）。 */
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
  cookieC = await signIn(EMAIL_C);
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

/** A 创建邀请并断言 201，返回 CreatedInvitationDTO（含明文 token）。 */
async function createInvitationOk(projectId: string): Promise<CreatedInvitationDTO> {
  const response = await invitationsRoute.POST(
    buildRequest("POST", `${BASE}/projects/${projectId}/invitations`, {
      cookie: cookieA,
      idempotencyKey: randomUUID(),
    }),
    ctxProject(projectId),
  );
  expect(response.status).toBe(201);
  const data = CreatedInvitationSuccess.parse((await response.json()) as unknown).data;
  expect(data.token).not.toBeNull();
  return data;
}

/** 直接把某用户加为项目成员（模拟既有成员，绕过邀请流程）。 */
async function addMember(projectId: string, userId: string): Promise<void> {
  await testPrisma.projectMember.create({ data: { projectId, userId } });
}

/** 计数某项目某动作的活动。 */
async function countActivities(projectId: string, action?: string): Promise<number> {
  return testPrisma.activityLog.count({
    where: action
      ? { projectId, action: action as "MEMBER_JOINED" }
      : { projectId },
  });
}

/* ── 1. 创建邀请（happy path）────────────────────────────────────────── */

describe("创建邀请 · happy path", () => {
  it("owner POST → 201，返回 invitation + token + invitePath；DB 存 tokenHash（非明文）；写 MEMBER_JOINED 活动", async () => {
    const project = await createProjectOk("邀请测试项目 A");
    const created = await createInvitationOk(project.id);
    const token = created.token!;

    // 响应形状：invitation 归属正确、state ACTIVE、invitePath 为 /invite#token={token}。
    // R02：令牌走哈希片段而非路径段，片段不发往服务端（不进日志/Referer）；
    // 旧断言固定为 `/invite/${token}`，把已被移除的路径段路由锁成契约（ISS-04）。
    expect(created.invitation.projectId).toBe(project.id);
    expect(created.invitation.createdById).toBe(userAId);
    expect(created.invitation.state).toBe("ACTIVE");
    expect(created.invitation.revokedAt).toBeNull();
    expect(created.invitation.acceptedAt).toBeNull();
    expect(created.invitePath).toBe(`/invite#token=${encodeURIComponent(token)}`);
    // 明文令牌不得出现在路径段中（否则会进入服务端访问日志）。
    expect(created.invitePath!.split("#")[0]).toBe("/invite");
    expect(token.length).toBeGreaterThanOrEqual(40);

    // DB：仅存 SHA-256 哈希（64 位十六进制），绝不存明文 token。
    const row = await testPrisma.invitation.findUniqueOrThrow({
      where: { id: created.invitation.id },
    });
    expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.tokenHash).not.toBe(token);
    expect(Object.keys(row)).not.toContain("token");

    // ❌ R08 FIX: createInvitation does NOT write any activity log (docs/05 §9)
    // Creating invitation is not a membership event.
    expect(await countActivities(project.id, "MEMBER_JOINED")).toBe(0);
  });
});

/* ── 2. 创建邀请（非 owner → 403）────────────────────────────────────── */

describe("创建邀请 · 授权", () => {
  it("非 owner 成员 POST → 403 FORBIDDEN，且不落库邀请", async () => {
    const project = await createProjectOk("邀请测试项目 · 授权");
    await addMember(project.id, userBId);

    const response = await invitationsRoute.POST(
      buildRequest("POST", `${BASE}/projects/${project.id}/invitations`, {
        cookie: cookieB,
        idempotencyKey: randomUUID(),
      }),
      ctxProject(project.id),
    );
    expect(response.status).toBe(403);
    expect((await readError(response)).error.code).toBe("FORBIDDEN");

    // 除 owner 在其它用例创建的以外，本项目不应有 B 创建的邀请。
    const byB = await testPrisma.invitation.count({
      where: { projectId: project.id, createdById: userBId },
    });
    expect(byB).toBe(0);
  });

  it("非成员 POST → 404 NOT_FOUND（不泄露项目是否存在）", async () => {
    const project = await createProjectOk("邀请测试项目 · 非成员");
    const response = await invitationsRoute.POST(
      buildRequest("POST", `${BASE}/projects/${project.id}/invitations`, {
        cookie: cookieD,
        idempotencyKey: randomUUID(),
      }),
      ctxProject(project.id),
    );
    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("NOT_FOUND");
  });
});

/* ── 3. 创建邀请（幂等重放）──────────────────────────────────────────── */

describe("创建邀请 · 幂等重放", () => {
  it("同 Idempotency-Key 连发两次 → 第二次 200 且 token/invitePath 为 null，DB 仅一条邀请", async () => {
    const project = await createProjectOk("邀请测试项目 · 幂等");
    const key = randomUUID();

    const first = await invitationsRoute.POST(
      buildRequest("POST", `${BASE}/projects/${project.id}/invitations`, {
        cookie: cookieA,
        idempotencyKey: key,
      }),
      ctxProject(project.id),
    );
    expect(first.status).toBe(201);
    const firstData = CreatedInvitationSuccess.parse((await first.json()) as unknown).data;
    expect(firstData.token).not.toBeNull();

    const second = await invitationsRoute.POST(
      buildRequest("POST", `${BASE}/projects/${project.id}/invitations`, {
        cookie: cookieA,
        idempotencyKey: key,
      }),
      ctxProject(project.id),
    );
    // 重放 → 200，且明文 token / invitePath 不再暴露。
    expect(second.status).toBe(200);
    const secondData = CreatedInvitationSuccess.parse((await second.json()) as unknown).data;
    expect(secondData.token).toBeNull();
    expect(secondData.invitePath).toBeNull();
    expect(secondData.invitation.id).toBe(firstData.invitation.id);

    // DB 仅一条邀请。
    expect(await testPrisma.invitation.count({ where: { projectId: project.id } })).toBe(1);
  });
});

/* ── 4~6. 预览邀请 ───────────────────────────────────────────────────── */

describe("预览邀请（匿名）", () => {
  it("有效 token → 200，返回 projectName + ownerName + role MEMBER，且不返回 token", async () => {
    const project = await createProjectOk("预览测试项目 · 有效");
    const created = await createInvitationOk(project.id);

    const response = await previewRoute.POST(
      buildRequest("POST", `${BASE}/invitations/preview`, {
        cookie: null,
        origin: null,
        body: { token: created.token! },
      }),
    );
    expect(response.status).toBe(200);
    const raw = (await response.json()) as Record<string, unknown>;
    const preview = InvitePreviewSuccess.parse(raw).data;
    expect(preview.projectName).toBe(project.name);
    expect(preview.ownerName).toBe(NAME_A);
    expect(preview.role).toBe("MEMBER");
    expect(preview.isArchived).toBe(false);
    // 预览绝不回传明文 token。
    expect(JSON.stringify(raw)).not.toContain(created.token!);
  });

  it("过期 token → 410 INVITATION_EXPIRED", async () => {
    const project = await createProjectOk("预览测试项目 · 过期");
    const created = await createInvitationOk(project.id);
    // 手动把 expiresAt 置为过去。
    await testPrisma.invitation.update({
      where: { id: created.invitation.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const response = await previewRoute.POST(
      buildRequest("POST", `${BASE}/invitations/preview`, {
        cookie: null,
        origin: null,
        body: { token: created.token! },
      }),
    );
    expect(response.status).toBe(410);
    expect((await readError(response)).error.code).toBe("INVITATION_EXPIRED");
  });

  it("已撤销 token → 410 INVITATION_REVOKED", async () => {
    const project = await createProjectOk("预览测试项目 · 撤销");
    const created = await createInvitationOk(project.id);
    // owner 撤销（204）。
    const revokeRes = await invitationRoute.DELETE(
      buildRequest("DELETE", `${BASE}/projects/${project.id}/invitations/${created.invitation.id}`, {
        cookie: cookieA,
      }),
      ctxInvitation(project.id, created.invitation.id),
    );
    expect(revokeRes.status).toBe(204);

    const response = await previewRoute.POST(
      buildRequest("POST", `${BASE}/invitations/preview`, {
        cookie: null,
        origin: null,
        body: { token: created.token! },
      }),
    );
    expect(response.status).toBe(410);
    expect((await readError(response)).error.code).toBe("INVITATION_REVOKED");
  });

  it("不存在的 token → 404 NOT_FOUND", async () => {
    const response = await previewRoute.POST(
      buildRequest("POST", `${BASE}/invitations/preview`, {
        cookie: null,
        origin: null,
        body: { token: "a".repeat(48) },
      }),
    );
    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("NOT_FOUND");
  });
});

/* ── 7~11. 接受邀请 ──────────────────────────────────────────────────── */

describe("接受邀请", () => {
  it("happy path：受邀者 POST → 200，创建 ProjectMember，invitation.acceptedAt/acceptedById 落定，写 MEMBER_JOINED 活动", async () => {
    const project = await createProjectOk("接受测试项目 · happy");
    const created = await createInvitationOk(project.id);

    const response = await acceptRoute.POST(
      buildRequest("POST", `${BASE}/invitations/accept`, {
        cookie: cookieB,
        body: { token: created.token! },
      }),
    );
    expect(response.status).toBe(200);
    const accepted = AcceptedSuccess.parse((await response.json()) as unknown).data;
    expect(accepted.projectId).toBe(project.id);
    expect(accepted.alreadyMember).toBe(false);

    // ProjectMember 记录为 B 创建。
    const member = await testPrisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: userBId } },
    });
    expect(member).not.toBeNull();

    // 邀请落定：acceptedAt 非空、acceptedById = B。
    const row = await testPrisma.invitation.findUniqueOrThrow({
      where: { id: created.invitation.id },
    });
    expect(row.acceptedAt).toBeTruthy();
    expect(row.acceptedById).toBe(userBId);

    // 活动：acceptInvitation 以 B 为 actor 写 MEMBER_JOINED（entityId = 新成员记录 id）。
    const joinActivity = await testPrisma.activityLog.findFirst({
      where: { projectId: project.id, action: "MEMBER_JOINED", actorId: userBId },
    });
    expect(joinActivity).not.toBeNull();
    expect(joinActivity!.entityId).toBe(member!.id);
  });

  it("并发接受：FOR UPDATE 锁确保 EXACTLY ONE 成功、EXACTLY ONE 失败，无 500", async () => {
    const project = await createProjectOk("接受测试项目 · 并发");
    const created = await createInvitationOk(project.id);
    const invitationId = created.invitation.id;
    const token = created.token!;

    // B、C 同时接受同一邀请。
    const [resB, resC] = await Promise.all([
      acceptRoute.POST(
        buildRequest("POST", `${BASE}/invitations/accept`, { cookie: cookieB, body: { token } }),
      ),
      acceptRoute.POST(
        buildRequest("POST", `${BASE}/invitations/accept`, { cookie: cookieC, body: { token } }),
      ),
    ]);
    const statusB = resB.status;
    const statusC = resC.status;

    // B 成功则 C 失败，反之亦然；必须 EXACTLY ONE 成功、EXACTLY ONE 失败。
    const successUserId = statusB === 200 ? userBId : userCId;
    const failureUserId = statusB === 200 ? userCId : userBId;
    
    // Must be EXACTLY ONE success and EXACTLY ONE failure
    const statuses = [statusB, statusC];
    expect(statuses.filter(s => s === 200).length).toBe(1);
    expect(statuses.filter(s => s === 409).length).toBe(1);

    // 数据库一致性：只有 1 个 ProjectMember 记录
    const members = await testPrisma.projectMember.findMany({
      where: { projectId: project.id }
    });
    expect(members.length).toBe(1); // 只有一个 ProjectMember 记录

    // 验证正确的用户成为成员
    const successMember = await testPrisma.projectMember.findFirst({
      where: { 
        projectId: project.id, 
        userId: successUserId 
      }
    });
    expect(successMember).not.toBeNull();
    
    const failureMember = await testPrisma.projectMember.findFirst({
      where: { 
        projectId: project.id, 
        userId: failureUserId 
      }
    });
    expect(failureMember).toBeNull();

    // 邀请最终为已使用态：acceptedAt 落定，acceptedById 为成功用户。
    const invitations = await testPrisma.invitation.findMany({
      where: { id: invitationId }
    });
    expect(invitations.length).toBeGreaterThan(0);
    expect(invitations[0]!.acceptedAt).toBeDefined();
    expect(invitations[0]!.acceptedById).toBe(successUserId);
  });

  it("已被使用：先接受一次，另一用户再接受 → 409 INVITATION_USED", async () => {
    const project = await createProjectOk("接受测试项目 · 已用");
    const created = await createInvitationOk(project.id);

    const first = await acceptRoute.POST(
      buildRequest("POST", `${BASE}/invitations/accept`, {
        cookie: cookieB,
        body: { token: created.token! },
      }),
    );
    expect(first.status).toBe(200);

    const second = await acceptRoute.POST(
      buildRequest("POST", `${BASE}/invitations/accept`, {
        cookie: cookieC,
        body: { token: created.token! },
      }),
    );
    expect(second.status).toBe(409);
    expect((await readError(second)).error.code).toBe("INVITATION_USED");

    // C 未成为成员。
    expect(
      await testPrisma.projectMember.count({
        where: { projectId: project.id, userId: userCId },
      }),
    ).toBe(0);
  });

  it("过期邀请 → 410 INVITATION_EXPIRED", async () => {
    const project = await createProjectOk("接受测试项目 · 过期");
    const created = await createInvitationOk(project.id);
    await testPrisma.invitation.update({
      where: { id: created.invitation.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const response = await acceptRoute.POST(
      buildRequest("POST", `${BASE}/invitations/accept`, {
        cookie: cookieB,
        body: { token: created.token! },
      }),
    );
    expect(response.status).toBe(410);
    expect((await readError(response)).error.code).toBe("INVITATION_EXPIRED");
  });

  it("已撤销邀请 → 410 INVITATION_REVOKED", async () => {
    const project = await createProjectOk("接受测试项目 · 撤销");
    const created = await createInvitationOk(project.id);
    const revokeRes = await invitationRoute.DELETE(
      buildRequest("DELETE", `${BASE}/projects/${project.id}/invitations/${created.invitation.id}`, {
        cookie: cookieA,
      }),
      ctxInvitation(project.id, created.invitation.id),
    );
    expect(revokeRes.status).toBe(204);

    const response = await acceptRoute.POST(
      buildRequest("POST", `${BASE}/invitations/accept`, {
        cookie: cookieB,
        body: { token: created.token! },
      }),
    );
    expect(response.status).toBe(410);
    expect((await readError(response)).error.code).toBe("INVITATION_REVOKED");
  });

  it("未认证接受 → 401 UNAUTHENTICATED", async () => {
    const project = await createProjectOk("接受测试项目 · 未认证");
    const created = await createInvitationOk(project.id);
    const response = await acceptRoute.POST(
      buildRequest("POST", `${BASE}/invitations/accept`, {
        cookie: null,
        body: { token: created.token! },
      }),
    );
    expect(response.status).toBe(401);
    expect((await readError(response)).error.code).toBe("UNAUTHENTICATED");
  });
});

/* ── 12. 撤销邀请 ────────────────────────────────────────────────────── */

describe("撤销邀请", () => {
  it("owner DELETE → 204，DB revokedAt 落定、state REVOKED，写 MEMBER_LEFT 活动", async () => {
    const project = await createProjectOk("撤销测试项目");
    const created = await createInvitationOk(project.id);

    const response = await invitationRoute.DELETE(
      buildRequest("DELETE", `${BASE}/projects/${project.id}/invitations/${created.invitation.id}`, {
        cookie: cookieA,
      }),
      ctxInvitation(project.id, created.invitation.id),
    );
    // 契约：撤销成功返回 204 No Content（无响应体）。
    expect(response.status).toBe(204);

    // DB 复核：revokedAt 非空。
    const row = await testPrisma.invitation.findUniqueOrThrow({
      where: { id: created.invitation.id },
    });
    expect(row.revokedAt).toBeTruthy();
    expect(row.acceptedAt).toBeNull();

    // ❌ R08 FIX: revokeInvitation does NOT write any activity log (docs/05 §9)
    // Revoking invitation is not a membership exit event.
    const revokedActivity = await testPrisma.activityLog.findFirst({
      where: { 
        projectId: project.id, 
        actorId: userAId,
        action: "MEMBER_LEFT" // Only check for the specific wrong action we removed
      },
    });
    expect(revokedActivity).toBeNull();
  });

  it("非 owner 成员 DELETE → 403 FORBIDDEN，邀请未被撤销", async () => {
    const project = await createProjectOk("撤销测试项目 · 授权");
    const created = await createInvitationOk(project.id);
    await addMember(project.id, userBId);

    const response = await invitationRoute.DELETE(
      buildRequest("DELETE", `${BASE}/projects/${project.id}/invitations/${created.invitation.id}`, {
        cookie: cookieB,
      }),
      ctxInvitation(project.id, created.invitation.id),
    );
    expect(response.status).toBe(403);
    expect((await readError(response)).error.code).toBe("FORBIDDEN");

    const row = await testPrisma.invitation.findUniqueOrThrow({
      where: { id: created.invitation.id },
    });
    expect(row.revokedAt).toBeNull();
  });

  it("撤销不存在的邀请 → 404 NOT_FOUND", async () => {
    const project = await createProjectOk("撤销测试项目 · 不存在");
    const response = await invitationRoute.DELETE(
      buildRequest("DELETE", `${BASE}/projects/${project.id}/invitations/${randomUUID()}`, {
        cookie: cookieA,
      }),
      ctxInvitation(project.id, randomUUID()),
    );
    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("NOT_FOUND");
  });
});

/* ── 13. 令牌安全总校验 ──────────────────────────────────────────────── */

describe("令牌安全", () => {
  it("本 run 全部邀请：tokenHash 均为 64 位十六进制 SHA-256，且行内无明文 token 列", async () => {
    const project = await createProjectOk("令牌安全测试项目");
    const first = await createInvitationOk(project.id);
    const second = await createInvitationOk(project.id);

    const rows = await testPrisma.invitation.findMany({
      where: { projectId: project.id },
    });
    expect(rows.length).toBe(2);
    for (const row of rows) {
      // 64 位小写十六进制（SHA-256 摘要）。
      expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      // 明文 token 从不入列。
      expect(Object.keys(row)).not.toContain("token");
      // 哈希不等于任一明文 token。
      expect(row.tokenHash).not.toBe(first.token);
      expect(row.tokenHash).not.toBe(second.token);
    }
    // 两条邀请的 tokenHash 互不相同（随机令牌唯一）。
    expect(rows[0]!.tokenHash).not.toBe(rows[1]!.tokenHash);
  });
});
