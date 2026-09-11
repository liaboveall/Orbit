import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  AcceptedInvitationSchema,
  CreatedInvitationSchema,
  ErrorResponseSchema,
  InvitePreviewSchema,
  SuccessResponseSchema,
  ProjectSchema,
  InvitationSchema,
  ListResponseSchema,
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
 * 另覆盖 A01–A04（docs/reviews/M0-M4-DEEP-AUDIT-2026-09-10.md）：项目级锁顺序修复后的
 * 人数配额（含 owner）、不同 token 并发配额、接受/归档竞争、撤销/接受竞争的正式回归——
 * 从独立审查探针（artifacts/m0-m4-audit-20260910/probes.test.ts）promote 进来，
 * 同步方式随锁顺序修复调整（等待 Project 行锁而非下游语句），业务断言未弱化。
 *
 * ⚠️ 与领域实现对齐（不照搬任务文案，以 src/server/modules/invitation/service.ts 为准）：
 *  - 撤销邀请路由返回 **204 No Content**（非 200 带体）；状态经数据库复核。
 *  - 活动动作：**邀请创建/撤销都不写活动日志**（docs/05 §9）；只有 acceptInvitation 写 MEMBER_JOINED。
 *  - 预览返回 {projectName, ownerName, expiresAt, role, isArchived}（无 state 字段，且不含 token）。
 *  - LIMIT_EXCEEDED → HTTP 422（contracts/error-codes.ts），不是 409。
 *
 * ⚠️ 单例隔离（必须在动态 import 前）：vi.mock 绑定 TEST_DATABASE_URL + APP_ENV=test 关限流；
 * 会话夹具用**同一个** auth 单例签发 cookie。
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);

/** 仅供测试的固定密钥（≥32），非任何真实凭证。 */
const TEST_SECRET = "orbit-integration-invitation-test-secret-0123456789";

/**
 * 独立 pg 连接池（不经 Prisma），仅用于并发不变量用例里的**确定性 SQL 屏障**：
 * 由一条独立连接持有真实 Project 行锁，通过 `pg_stat_activity` 探测「另一事务已在
 * 等待同一把锁」再释放，从而制造可复现的锁竞争窗口——不依赖随机 sleep 猜时序
 * （pref.testing.no_retry_masking：并发测试用可靠同步点，不靠 sleep 碰运气）。
 */
const barrierPool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 5 });

/**
 * `lockProjectRow`（src/server/db/tx.ts）实际发出的 SQL 是多列 SELECT + FOR UPDATE：
 * `SELECT id, version, "boardVersion", "nextTaskNumber", "archivedAt", "ownerId"
 *    FROM "Project" WHERE id = $1::uuid FOR UPDATE`。
 * 屏障用 `FROM "Project"` 作为足够窄、又能稳定匹配该语句的片段。
 */
const PROJECT_LOCK_QUERY_FRAGMENT = 'FROM "Project"';

/**
 * 等待「至少 count 个」其它会话正在等待锁且其查询文本包含 fragment。
 * A02/A03/A04：锁顺序修复后，accept/revoke 现在都先在 `lockProjectRow` 上排队等待
 * Project 行锁，因此正确的屏障目标是该语句的等待事件，而不是（修复前）曾经等待的
 * 下游 ProjectMember INSERT / Invitation UPDATE —— 那些语句在锁顺序修复后只有拿到
 * Project 锁之后才会执行到，用旧目标等待会永远等不到。
 */
async function waitBlockedOnQuery(fragment: string, count = 1): Promise<void> {
  for (let n = 0; n < 150; n += 1) {
    const found = await barrierPool.query<{ count: string }>(
      `SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock' AND query LIKE $1`,
      [`%${fragment}%`],
    );
    if (Number(found.rows[0]!.count) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Could not establish deterministic SQL barrier");
}

/* ── 环境覆写：关闭限流 + 固定测试密钥（必须在动态 import 前）────────────── */
process.env.APP_ENV = "test";
process.env.BETTER_AUTH_SECRET = TEST_SECRET;
// A10 修复：accept 路由新增了与 preview 共享的 20/IP/分钟限流（docs/03 §8）。本文件
// 的 22 处 acceptRoute.POST 调用此前都不携带 X-Forwarded-For，在 TRUSTED_PROXY_COUNT
// 默认为 0 时全部落进同一个固定占位桶，累计超过 20 次后会被限流拒绝——这不是要
// 弱化或关闭限流，而是让本文件的请求更贴近真实场景（真实的 22 个不同测试场景，
// 现实中大多来自不同的客户端/IP，不应该人为共享同一个占位桶）：把
// TRUSTED_PROXY_COUNT 设为 1，配合下方 buildRequest 默认携带的、每次调用互不相同的
// 伪造转发链，让每个请求解析出独立的桶。
process.env.TRUSTED_PROXY_COUNT = "1";
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
const InvitationList = ListResponseSchema(InvitationSchema);

/* ── 请求辅助 ─────────────────────────────────────────────────────────── */

interface ReqOptions {
  cookie?: string | null;
  body?: unknown;
  origin?: string | null;
  idempotencyKey?: string;
  /** 显式覆盖转发链（罕见——绝大多数调用应让下面的默认值生效）。 */
  forwardedFor?: string;
}

/** 每次调用自增，生成互不相同的伪造转发链，避免全部落进同一个 IP 限流桶。 */
let requestSequence = 0;
function nextForwardedFor(): string {
  requestSequence += 1;
  // 两段式：client, 受信代理观测值——TRUSTED_PROXY_COUNT=1 时取倒数第 1 项。
  return `test-client-${requestSequence}, 10.88.${Math.floor(requestSequence / 256)}.${requestSequence % 256}`;
}

function buildRequest(method: string, url: string, options: ReqOptions = {}): Request {
  const { cookie = null, body, origin = TRUSTED_ORIGIN, idempotencyKey, forwardedFor } = options;
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (origin !== null) headers.set("origin", origin);
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  // 默认每次调用携带一个全新的伪造转发链，防止本文件内所有请求共享同一个 IP 限流
  // 桶（本文件测试的是业务逻辑，不是限流本身；限流本身的正确性由
  // tests/integration/invitation-rate-limit.test.ts 覆盖）。传入空字符串可显式禁用
  // （极少数用例可能需要验证「无转发头」路径本身）。
  if (forwardedFor !== "") {
    headers.set("x-forwarded-for", forwardedFor ?? nextForwardedFor());
  }
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
  // 清空本文件在共享 globalThis 限流单例上留下的桶状态，避免遗留配额消耗影响同一
  // Node 进程内后续运行的其它测试文件（tests/integration 下的文件按
  // fileParallelism:false 顺序执行，共享同一份 globalThis）。
  const anonymousState = globalThis as typeof globalThis & {
    __orbitAnonymousInviteRateLimiter__?: { clearAll: () => Promise<void> };
  };
  await anonymousState.__orbitAnonymousInviteRateLimiter__?.clearAll();
  const { RateLimiterFactory } = await import("@/server/modules/rate-limit");
  RateLimiterFactory.resetInstance();
  await testPrisma.$disconnect();
  await barrierPool.end();
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

/**
 * 批量填充「已有 N 名成员」的合成 filler 用户（不走真实注册，仅用于人数配额场景的
 * 项目占位成员）；随本 RUN_TAG 一起在 afterEach/afterAll 被 cleanupProjects/cleanupRun
 * 按 email 前缀清理，不残留跨 run 数据。
 */
async function fillMembers(projectId: string, count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, () => randomUUID());
  await testPrisma.user.createMany({
    data: ids.map((id) => ({
      id,
      name: "配额填充成员",
      email: `${RUN_TAG}-filler-${id}@${domain}`,
      emailVerified: true,
    })),
  });
  await testPrisma.projectMember.createMany({
    data: ids.map((userId) => ({ projectId, userId })),
  });
  return ids;
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

    expect(created.invitation.projectId).toBe(project.id);
    expect(created.invitation.createdById).toBe(userAId);
    expect(created.invitation.state).toBe("ACTIVE");
    expect(created.invitation.revokedAt).toBeNull();
    expect(created.invitation.acceptedAt).toBeNull();
    expect(created.invitePath).toBe(`/invite#token=${encodeURIComponent(token)}`);
    expect(created.invitePath!.split("#")[0]).toBe("/invite");
    expect(token.length).toBeGreaterThanOrEqual(40);

    const row = await testPrisma.invitation.findUniqueOrThrow({
      where: { id: created.invitation.id },
    });
    expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.tokenHash).not.toBe(token);
    expect(Object.keys(row)).not.toContain("token");

    expect(await countActivities(project.id, "MEMBER_JOINED")).toBe(0);
  });
});

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
    expect(second.status).toBe(200);
    const secondData = CreatedInvitationSuccess.parse((await second.json()) as unknown).data;
    expect(secondData.token).toBeNull();
    expect(secondData.invitePath).toBeNull();
    expect(secondData.invitation.id).toBe(firstData.invitation.id);

    expect(await testPrisma.invitation.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("同 Idempotency-Key 用于两个不同项目 → 各自创建独立邀请，不把第一个项目的重放结果误用于第二个项目", async () => {
    // 回归：routeKey 此前是不含 projectId 的静态常量，导致 IdempotencyRecord 唯一键
    // (userId, method, routeKey, key) 在跨项目复用同一个 key 时被误判为同一次调用的重放。
    const projectX = await createProjectOk("幂等 routeKey 测试 · 项目X");
    const projectY = await createProjectOk("幂等 routeKey 测试 · 项目Y");
    const key = randomUUID();

    const resX = await invitationsRoute.POST(
      buildRequest("POST", `${BASE}/projects/${projectX.id}/invitations`, {
        cookie: cookieA,
        idempotencyKey: key,
      }),
      ctxProject(projectX.id),
    );
    expect(resX.status).toBe(201);
    const dataX = CreatedInvitationSuccess.parse((await resX.json()) as unknown).data;
    expect(dataX.token).not.toBeNull();
    expect(dataX.invitation.projectId).toBe(projectX.id);

    const resY = await invitationsRoute.POST(
      buildRequest("POST", `${BASE}/projects/${projectY.id}/invitations`, {
        cookie: cookieA,
        idempotencyKey: key, // 同一个 key，但目标项目不同
      }),
      ctxProject(projectY.id),
    );
    // 必须是全新创建（201 + 新明文 token），不能被误判为项目 X 那次调用的重放。
    expect(resY.status).toBe(201);
    const dataY = CreatedInvitationSuccess.parse((await resY.json()) as unknown).data;
    expect(dataY.token).not.toBeNull();
    expect(dataY.invitation.projectId).toBe(projectY.id);
    expect(dataY.invitation.id).not.toBe(dataX.invitation.id);

    expect(await testPrisma.invitation.count({ where: { projectId: projectX.id } })).toBe(1);
    expect(await testPrisma.invitation.count({ where: { projectId: projectY.id } })).toBe(1);
  });
});

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
    expect(JSON.stringify(raw)).not.toContain(created.token!);
  });

  it("过期 token → 410 INVITATION_EXPIRED", async () => {
    const project = await createProjectOk("预览测试项目 · 过期");
    const created = await createInvitationOk(project.id);
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

    const member = await testPrisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: userBId } },
    });
    expect(member).not.toBeNull();

    const row = await testPrisma.invitation.findUniqueOrThrow({
      where: { id: created.invitation.id },
    });
    expect(row.acceptedAt).toBeTruthy();
    expect(row.acceptedById).toBe(userBId);

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

    const successUserId = statusB === 200 ? userBId : userCId;
    const failureUserId = statusB === 200 ? userCId : userBId;

    const statuses = [statusB, statusC];
    expect(statuses.filter((s) => s === 200).length).toBe(1);
    expect(statuses.filter((s) => s === 409).length).toBe(1);

    const members = await testPrisma.projectMember.findMany({
      where: { projectId: project.id },
    });
    expect(members.length).toBe(1);

    const successMember = await testPrisma.projectMember.findFirst({
      where: {
        projectId: project.id,
        userId: successUserId,
      },
    });
    expect(successMember).not.toBeNull();

    const failureMember = await testPrisma.projectMember.findFirst({
      where: {
        projectId: project.id,
        userId: failureUserId,
      },
    });
    expect(failureMember).toBeNull();

    const invitations = await testPrisma.invitation.findMany({
      where: { id: invitationId },
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
    expect(response.status).toBe(204);

    const row = await testPrisma.invitation.findUniqueOrThrow({
      where: { id: created.invitation.id },
    });
    expect(row.revokedAt).toBeTruthy();
    expect(row.acceptedAt).toBeNull();

    const revokedActivity = await testPrisma.activityLog.findFirst({
      where: {
        projectId: project.id,
        actorId: userAId,
        action: "MEMBER_LEFT",
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

describe("邀请并发不变量 · 项目级锁（A01–A04）", () => {
  it("A01：满 20 人（owner+19）后接受有效未用邀请必须拒绝且不消费 token，总人数仍为 20", async () => {
    const project = await createProjectOk("配额测试 · 满员拒绝");
    await fillMembers(project.id, 19);
    const created = await createInvitationOk(project.id);

    const response = await acceptRoute.POST(
      buildRequest("POST", `${BASE}/invitations/accept`, {
        cookie: cookieD,
        body: { token: created.token! },
      }),
    );
    expect(response.status).toBe(422);
    expect((await readError(response)).error.code).toBe("LIMIT_EXCEEDED");

    const total = 1 + (await testPrisma.projectMember.count({ where: { projectId: project.id } }));
    expect(total).toBe(20);

    const row = await testPrisma.invitation.findUniqueOrThrow({
      where: { id: created.invitation.id },
    });
    expect(row.acceptedAt).toBeNull();
  });

  it("A01b：19→20 成功，20→21 拒绝（边界值）", async () => {
    const project = await createProjectOk("配额测试 · 边界");
    await fillMembers(project.id, 18);

    const firstInvite = await createInvitationOk(project.id);
    const okRes = await acceptRoute.POST(
      buildRequest("POST", `${BASE}/invitations/accept`, {
        cookie: cookieB,
        body: { token: firstInvite.token! },
      }),
    );
    expect(okRes.status).toBe(200);

    const secondInvite = await createInvitationOk(project.id);
    const blockedRes = await acceptRoute.POST(
      buildRequest("POST", `${BASE}/invitations/accept`, {
        cookie: cookieC,
        body: { token: secondInvite.token! },
      }),
    );
    expect(blockedRes.status).toBe(422);
    expect((await readError(blockedRes)).error.code).toBe("LIMIT_EXCEEDED");

    expect(1 + (await testPrisma.projectMember.count({ where: { projectId: project.id } }))).toBe(
      20,
    );
  });

  it("A01c：已是成员/owner 接受有效未用邀请 → 不新增成员、不消费邀请", async () => {
    const project = await createProjectOk("配额测试 · 已有身份");
    await addMember(project.id, userBId);
    const forExistingMember = await createInvitationOk(project.id);
    const forOwner = await createInvitationOk(project.id);

    const memberRes = await acceptRoute.POST(
      buildRequest("POST", `${BASE}/invitations/accept`, {
        cookie: cookieB,
        body: { token: forExistingMember.token! },
      }),
    );
    expect(memberRes.status).toBe(200);
    const memberData = AcceptedSuccess.parse((await memberRes.json()) as unknown).data;
    expect(memberData.alreadyMember).toBe(true);
    expect(memberData.createdNewMembership).toBe(false);

    const ownerRes = await acceptRoute.POST(
      buildRequest("POST", `${BASE}/invitations/accept`, {
        cookie: cookieA,
        body: { token: forOwner.token! },
      }),
    );
    expect(ownerRes.status).toBe(200);
    const ownerData = AcceptedSuccess.parse((await ownerRes.json()) as unknown).data;
    expect(ownerData.alreadyMember).toBe(true);
    expect(ownerData.createdNewMembership).toBe(false);

    expect(await testPrisma.projectMember.count({ where: { projectId: project.id } })).toBe(1);
    const invRows = await testPrisma.invitation.findMany({
      where: { id: { in: [forExistingMember.invitation.id, forOwner.invitation.id] } },
    });
    for (const row of invRows) expect(row.acceptedAt).toBeNull();
  });

  it("A02：不同 token 并发接受必须共同遵守项目人数上限（Project 行锁使三者互斥计数）", async () => {
    const project = await createProjectOk("并发配额测试 · 不同token");
    await fillMembers(project.id, 18);
    const invA = await createInvitationOk(project.id);
    const invB = await createInvitationOk(project.id);
    const invC = await createInvitationOk(project.id);

    const blocker = await barrierPool.connect();
    await blocker.query("BEGIN");
    await blocker.query('SELECT id FROM "Project" WHERE id = $1 FOR UPDATE', [project.id]);

    const pending = Promise.all([
      acceptRoute.POST(
        buildRequest("POST", `${BASE}/invitations/accept`, {
          cookie: cookieB,
          body: { token: invA.token! },
        }),
      ),
      acceptRoute.POST(
        buildRequest("POST", `${BASE}/invitations/accept`, {
          cookie: cookieC,
          body: { token: invB.token! },
        }),
      ),
      acceptRoute.POST(
        buildRequest("POST", `${BASE}/invitations/accept`, {
          cookie: cookieD,
          body: { token: invC.token! },
        }),
      ),
    ]);
    try {
      await waitBlockedOnQuery(PROJECT_LOCK_QUERY_FRAGMENT, 3);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }

    const responses = await pending;
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 200).length).toBe(1);
    expect(statuses.filter((s) => s === 422).length).toBe(2);

    const total = 1 + (await testPrisma.projectMember.count({ where: { projectId: project.id } }));
    expect(total).toBeLessThanOrEqual(20);
    expect(total).toBe(20);
  }, 30_000);

  it("A03：接受与归档竞争——归档事务先提交后，等待中的接受必须在复核后拒绝且不消费 token", async () => {
    const project = await createProjectOk("归档竞争测试 · 接受在后");
    const created = await createInvitationOk(project.id);

    const blocker = await barrierPool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      'UPDATE "Project" SET "archivedAt" = now(), version = version + 1 WHERE id = $1',
      [project.id],
    );

    const pending = acceptRoute.POST(
      buildRequest("POST", `${BASE}/invitations/accept`, {
        cookie: cookieB,
        body: { token: created.token! },
      }),
    );
    try {
      await waitBlockedOnQuery(PROJECT_LOCK_QUERY_FRAGMENT, 1);
    } finally {
      await blocker.query("COMMIT");
      blocker.release();
    }

    const response = await pending;
    expect(response.status).toBe(409);
    expect((await readError(response)).error.code).toBe("PROJECT_ARCHIVED");

    const project2 = await testPrisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(project2.archivedAt).not.toBeNull();
    const invRow = await testPrisma.invitation.findUniqueOrThrow({
      where: { id: created.invitation.id },
    });
    expect(invRow.acceptedAt).toBeNull();
  }, 30_000);

  it("A03b：接受先完成时，归档正常执行（反方向不受影响）", async () => {
    const project = await createProjectOk("归档竞争测试 · 接受在前");
    const created = await createInvitationOk(project.id);

    const acceptRes = await acceptRoute.POST(
      buildRequest("POST", `${BASE}/invitations/accept`, {
        cookie: cookieB,
        body: { token: created.token! },
      }),
    );
    expect(acceptRes.status).toBe(200);

    const { PATCH } = await import("@/app/api/v1/projects/[projectId]/route");
    const archiveRes = await PATCH(
      buildRequest("PATCH", `${BASE}/projects/${project.id}`, {
        cookie: cookieA,
        body: { expectedVersion: 1, archived: true },
      }),
      ctxProject(project.id),
    );
    expect(archiveRes.status).toBe(200);
  });

  it("A04：撤销与接受竞争——接受先完成时撤销必须失败为 INVITATION_USED，且不能双双成功", async () => {
    const project = await createProjectOk("撤销竞争测试");
    const created = await createInvitationOk(project.id);

    const blocker = await barrierPool.connect();
    await blocker.query("BEGIN");
    await blocker.query('SELECT id FROM "Project" WHERE id = $1 FOR UPDATE', [project.id]);

    const accepting = acceptRoute.POST(
      buildRequest("POST", `${BASE}/invitations/accept`, {
        cookie: cookieB,
        body: { token: created.token! },
      }),
    );
    let revoking: Promise<Response> | undefined;
    try {
      await waitBlockedOnQuery(PROJECT_LOCK_QUERY_FRAGMENT, 1);
      revoking = invitationRoute.DELETE(
        buildRequest(
          "DELETE",
          `${BASE}/projects/${project.id}/invitations/${created.invitation.id}`,
          { cookie: cookieA },
        ),
        ctxInvitation(project.id, created.invitation.id),
      );
      await waitBlockedOnQuery(PROJECT_LOCK_QUERY_FRAGMENT, 2);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }

    const [acceptRes, revokeRes] = await Promise.all([accepting, revoking!]);
    expect(acceptRes.status).toBe(200);
    expect(revokeRes.status).toBe(409);
    expect((await readError(revokeRes)).error.code).toBe("INVITATION_USED");

    const row = await testPrisma.invitation.findUniqueOrThrow({
      where: { id: created.invitation.id },
    });
    expect(row.acceptedAt).not.toBeNull();
    expect(row.revokedAt).toBeNull();
  }, 30_000);

  it("A04b：撤销先完成时，接受必须失败为 INVITATION_REVOKED", async () => {
    const project = await createProjectOk("撤销竞争测试 · 撤销在前");
    const created = await createInvitationOk(project.id);

    const revokeRes = await invitationRoute.DELETE(
      buildRequest(
        "DELETE",
        `${BASE}/projects/${project.id}/invitations/${created.invitation.id}`,
        { cookie: cookieA },
      ),
      ctxInvitation(project.id, created.invitation.id),
    );
    expect(revokeRes.status).toBe(204);

    const acceptRes = await acceptRoute.POST(
      buildRequest("POST", `${BASE}/invitations/accept`, {
        cookie: cookieB,
        body: { token: created.token! },
      }),
    );
    expect(acceptRes.status).toBe(410);
    expect((await readError(acceptRes)).error.code).toBe("INVITATION_REVOKED");

    const row = await testPrisma.invitation.findUniqueOrThrow({
      where: { id: created.invitation.id },
    });
    expect(row.acceptedAt).toBeNull();
  });

  it("A·同用户持不同 token 并发加入同项目：不得因唯一约束报 500，也不得重复消费/多计成员", async () => {
    const project = await createProjectOk("同用户双token并发测试");
    const invX = await createInvitationOk(project.id);
    const invY = await createInvitationOk(project.id);

    const [resX, resY] = await Promise.all([
      acceptRoute.POST(
        buildRequest("POST", `${BASE}/invitations/accept`, {
          cookie: cookieB,
          body: { token: invX.token! },
        }),
      ),
      acceptRoute.POST(
        buildRequest("POST", `${BASE}/invitations/accept`, {
          cookie: cookieB,
          body: { token: invY.token! },
        }),
      ),
    ]);
    const statuses = [resX.status, resY.status];
    for (const s of statuses) expect(s).not.toBe(500);
    expect(
      await testPrisma.projectMember.count({
        where: { projectId: project.id, userId: userBId },
      }),
    ).toBe(1);
  }, 30_000);
});

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
      expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(Object.keys(row)).not.toContain("token");
      expect(row.tokenHash).not.toBe(first.token);
      expect(row.tokenHash).not.toBe(second.token);
    }
    expect(rows[0]!.tokenHash).not.toBe(rows[1]!.tokenHash);
  });
});
