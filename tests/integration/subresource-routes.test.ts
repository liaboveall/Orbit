import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { getEnv, parseEnv } from "@/server/env";
import {
  CommentSchema,
  ErrorResponseSchema,
  SuccessResponseSchema,
  SubtaskSchema,
} from "@/contracts";

/**
 * 子资源 HTTP 路由负面矩阵（E1 修复，docs/05 §4/§5/§6、docs/07）。
 *
 * 背景：评论/子任务/附件 5 个 route.ts 此前在全部 Vitest 运行中 0% 执行——
 * 集成测试直调 service，绕过了 HTTP 层的 Origin/会话/路径参数/请求体/状态码映射。
 * 本文件**直调真实 route handler（Request 进 / Response 出）**，按方法×状态×角色矩阵覆盖：
 *  - 401 未认证；404 非法 UUID/非成员/父任务软删除/跨项目资源（不泄露存在性）；
 *  - 403 非作者的评论编辑；409 版本冲突/归档项目写入；
 *  - 400 非法 JSON/缺失 expectedVersion/非法表单；413 超 64KiB 请求体；
 *  - C1：评论删除返回 200 + 删除占位 Comment（body=null、isDeleted=true、version 递增）；
 *  - C3：撤销邀请非法 UUID → 404（不再 500）。
 *
 * 隔离：与 invitations.test.ts 相同模式——vi.mock 绑定 orbit_test、TRUSTED_PROXY_COUNT=1、
 * 精确夹具清理（按 runTag 删用户，按 projectId 删项目数据），不动无关数据。
 */

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);

const TEST_SECRET = "orbit-route-matrix-test-secret-0123456789";

process.env.APP_ENV = "test";
process.env.BETTER_AUTH_SECRET = TEST_SECRET;
process.env.TRUSTED_PROXY_COUNT = "1";
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
const taskCommentsRoute = await import("@/app/api/v1/tasks/[taskId]/comments/route");
const commentRoute = await import("@/app/api/v1/comments/[commentId]/route");
const taskSubtasksRoute = await import("@/app/api/v1/tasks/[taskId]/subtasks/route");
const subtaskRoute = await import("@/app/api/v1/subtasks/[subtaskId]/route");
const taskAttachmentsRoute = await import("@/app/api/v1/tasks/[taskId]/attachments/route");
const attachmentRoute = await import("@/app/api/v1/attachments/[attachmentId]/route");
const invitationRoute = await import(
  "@/app/api/v1/projects/[projectId]/invitations/[invitationId]/route"
);
const { auth } = await import("@/server/auth");
const { prisma: testPrisma } = await import("@/server/db/prisma");

/* ── 夹具 ─────────────────────────────────────────────────────────────── */

const RUN_TAG = `rt-${Date.now()}`;
const PASSWORD = "RouteMatrix!Pass0rd";
const BASE = `${env.BETTER_AUTH_URL}/api/v1`;
const TRUSTED_ORIGIN =
  env.AUTH_TRUSTED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0] ?? env.BETTER_AUTH_URL;

const CommentSuccess = SuccessResponseSchema(CommentSchema);
const SubtaskSuccess = SuccessResponseSchema(SubtaskSchema);

const ownerEmail = `${RUN_TAG}-owner@orbit.test`;
const memberEmail = `${RUN_TAG}-member@orbit.test`;
const outsiderEmail = `${RUN_TAG}-outsider@orbit.test`;

let cookieOwner = "";
let cookieMember = "";
let cookieOutsider = "";
let ownerId = "";
let projectId = "";
let activeTaskId = "";
let archivedProjectId = "";
let archivedTaskId = "";

let requestSequence = 0;
function nextForwardedFor(): string {
  requestSequence += 1;
  return `route-client-${requestSequence}, 10.89.${Math.floor(requestSequence / 256)}.${requestSequence % 256}`;
}

interface ReqOptions {
  cookie?: string | null;
  body?: unknown;
  origin?: string | null;
  idempotencyKey?: string;
  contentType?: string;
  rawBody?: string;
}

function buildRequest(method: string, url: string, options: ReqOptions = {}): Request {
  const { cookie = null, body, origin = TRUSTED_ORIGIN, idempotencyKey, contentType, rawBody } = options;
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (origin !== null) headers.set("origin", origin);
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  headers.set("x-forwarded-for", nextForwardedFor());
  if (body !== undefined) {
    headers.set("content-type", contentType ?? "application/json");
    headers.set("content-length", String(new TextEncoder().encode(JSON.stringify(body)).length));
    return new Request(url, { method, headers, body: JSON.stringify(body) });
  }
  if (rawBody !== undefined) {
    headers.set("content-type", contentType ?? "application/json");
    return new Request(url, { method, headers, body: rawBody });
  }
  return new Request(url, { method, headers });
}

/** 构造路由 context.params；Promise<never> 可赋给任意路由的 params 形状。 */
function ctx(key: string, id: string, extra: Record<string, string> = {}): { params: Promise<never> } {
  return { params: Promise.resolve({ [key]: id, ...extra }) as never };
}

async function readError(response: Response) {
  return ErrorResponseSchema.parse((await response.json()) as unknown);
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

async function createProjectFixture(archived: boolean): Promise<{ projectId: string; taskId: string }> {
  const pid = randomUUID();
  const tid = randomUUID();
  await testPrisma.project.create({
    data: {
      id: pid,
      ownerId: ownerId,
      key: "R" + randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase(),
      name: archived ? "路由矩阵·归档项目" : "路由矩阵·活跃项目",
      color: "BLUE",
      archivedAt: archived ? new Date() : null,
    },
  });
  await testPrisma.task.create({
    data: {
      id: tid,
      projectId: pid,
      number: 1,
      creatorId: ownerId,
      title: "路由矩阵任务",
      position: 1024n,
    },
  });
  return { projectId: pid, taskId: tid };
}

beforeAll(async () => {
  await signUpVerified(ownerEmail, "路由所有者");
  await signUpVerified(memberEmail, "路由成员");
  await signUpVerified(outsiderEmail, "路由局外");
  cookieOwner = await signIn(ownerEmail);
  cookieMember = await signIn(memberEmail);
  cookieOutsider = await signIn(outsiderEmail);
  ownerId = (await testPrisma.user.findUniqueOrThrow({ where: { email: ownerEmail } })).id;

  const active = await createProjectFixture(false);
  projectId = active.projectId;
  activeTaskId = active.taskId;
  await testPrisma.projectMember.create({ data: { projectId, userId: (await testPrisma.user.findUniqueOrThrow({ where: { email: memberEmail } })).id } });

  const archived = await createProjectFixture(true);
  archivedProjectId = archived.projectId;
  archivedTaskId = archived.taskId;
});

afterAll(async () => {
  // 精确清理：仅回收本 run 创建的夹具（按 projectId / runTag），不动无关数据。
  for (const pid of [projectId, archivedProjectId]) {
    if (!pid) continue;
    await testPrisma.comment.deleteMany({ where: { task: { projectId: pid } } });
    await testPrisma.subtask.deleteMany({ where: { task: { projectId: pid } } });
    await testPrisma.activityLog.deleteMany({ where: { projectId: pid } });
    await testPrisma.task.deleteMany({ where: { projectId: pid } });
    await testPrisma.projectMember.deleteMany({ where: { projectId: pid } });
    await testPrisma.project.deleteMany({ where: { id: pid } });
  }
  const emails = [ownerEmail, memberEmail, outsiderEmail];
  const users = await testPrisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  await testPrisma.idempotencyRecord.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await testPrisma.verification.deleteMany({
    where: {
      OR: [
        { identifier: { in: emails } },
        { value: { in: users.map((u) => u.id) }, identifier: { startsWith: "reset-password:" } },
      ],
    },
  });
  await testPrisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await testPrisma.$disconnect();
});

/* ── 评论路由矩阵 ─────────────────────────────────────────────────────── */

describe("评论路由（HTTP 层矩阵，E1）", () => {
  it("GET /tasks/{taskId}/comments：401 未认证 / 404 非成员与非法UUID / 200 成员", async () => {
    const noAuth = await taskCommentsRoute.GET(
      buildRequest("GET", `${BASE}/tasks/${activeTaskId}/comments`, { cookie: null }),
      ctx("taskId", activeTaskId),
    );
    expect(noAuth.status).toBe(401);

    const outsider = await taskCommentsRoute.GET(
      buildRequest("GET", `${BASE}/tasks/${activeTaskId}/comments`, { cookie: cookieOutsider }),
      ctx("taskId", activeTaskId),
    );
    expect(outsider.status).toBe(404);

    const badUuid = await taskCommentsRoute.GET(
      buildRequest("GET", `${BASE}/tasks/not-a-uuid/comments`, { cookie: cookieMember }),
      ctx("taskId", "not-a-uuid"),
    );
    expect(badUuid.status).toBe(404);

    const member = await taskCommentsRoute.GET(
      buildRequest("GET", `${BASE}/tasks/${activeTaskId}/comments`, { cookie: cookieMember }),
      ctx("taskId", activeTaskId),
    );
    expect(member.status).toBe(200);
  });

  it("POST /tasks/{taskId}/comments：404 局外 / 400 非法JSON与非法body / 201 成员 / 409 归档项目", async () => {
    const outsider = await taskCommentsRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${activeTaskId}/comments`, {
        cookie: cookieOutsider,
        body: { body: "局外" },
        idempotencyKey: randomUUID(),
      }),
      ctx("taskId", activeTaskId),
    );
    expect(outsider.status).toBe(404);

    const malformed = await taskCommentsRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${activeTaskId}/comments`, {
        cookie: cookieMember,
        rawBody: "{not json",
        idempotencyKey: randomUUID(),
      }),
      ctx("taskId", activeTaskId),
    );
    expect(malformed.status).toBe(400);

    const empty = await taskCommentsRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${activeTaskId}/comments`, {
        cookie: cookieMember,
        body: { body: "   " },
        idempotencyKey: randomUUID(),
      }),
      ctx("taskId", activeTaskId),
    );
    expect(empty.status).toBe(400);
    expect((await readError(empty)).error.code).toBe("VALIDATION_ERROR");

    const archived = await taskCommentsRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${archivedTaskId}/comments`, {
        cookie: cookieOwner,
        body: { body: "归档写入" },
        idempotencyKey: randomUUID(),
      }),
      ctx("taskId", archivedTaskId),
    );
    expect(archived.status).toBe(409);
    expect((await readError(archived)).error.code).toBe("PROJECT_ARCHIVED");

    const created = await taskCommentsRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${activeTaskId}/comments`, {
        cookie: cookieMember,
        body: { body: "成员的评论" },
        idempotencyKey: randomUUID(),
      }),
      ctx("taskId", activeTaskId),
    );
    expect(created.status).toBe(201);
    const body = CommentSuccess.parse((await created.json()) as unknown);
    expect(body.data.body).toBe("成员的评论");
  });

  it("POST 超过64KiB请求体 → 413（路由层真实读取），而非500/截断", async () => {
    const huge = "x".repeat(70 * 1024);
    const res = await taskCommentsRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${activeTaskId}/comments`, {
        cookie: cookieMember,
        body: { body: huge },
        idempotencyKey: randomUUID(),
      }),
      ctx("taskId", activeTaskId),
    );
    expect(res.status).toBe(413);
    expect((await readError(res)).error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("PATCH /comments/{commentId}：401/404非法UUID与跨项目/403非作者/409版本冲突/200作者编辑", async () => {
    const created = await taskCommentsRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${activeTaskId}/comments`, {
        cookie: cookieMember,
        body: { body: "待编辑评论" },
        idempotencyKey: randomUUID(),
      }),
      ctx("taskId", activeTaskId),
    );
    const { data: comment } = CommentSuccess.parse((await created.json()) as unknown);

    const noAuth = await commentRoute.PATCH(
      buildRequest("PATCH", `${BASE}/comments/${comment.id}`, {
        cookie: null,
        body: { expectedVersion: 1, body: "未认证" },
      }),
      ctx("commentId", comment.id),
    );
    expect(noAuth.status).toBe(401);

    const badUuid = await commentRoute.PATCH(
      buildRequest("PATCH", `${BASE}/comments/not-a-uuid`, {
        cookie: cookieMember,
        body: { expectedVersion: 1, body: "坏ID" },
      }),
      ctx("commentId", "not-a-uuid"),
    );
    expect(badUuid.status).toBe(404);

    // 局外用户 → 404（不泄露存在性）
    const outsider = await commentRoute.PATCH(
      buildRequest("PATCH", `${BASE}/comments/${comment.id}`, {
        cookie: cookieOutsider,
        body: { expectedVersion: 1, body: "局外" },
      }),
      ctx("commentId", comment.id),
    );
    expect(outsider.status).toBe(404);

    // 非 owner 的项目成员不是作者 → 403（作者本人才能编辑）
    const ownerEdit = await commentRoute.PATCH(
      buildRequest("PATCH", `${BASE}/comments/${comment.id}`, {
        cookie: cookieOwner,
        body: { expectedVersion: 1, body: "owner 编辑" },
      }),
      ctx("commentId", comment.id),
    );
    expect(ownerEdit.status).toBe(403);

    // 版本冲突 → 409 + currentVersion
    const conflict = await commentRoute.PATCH(
      buildRequest("PATCH", `${BASE}/comments/${comment.id}`, {
        cookie: cookieMember,
        body: { expectedVersion: 99, body: "过期版本" },
      }),
      ctx("commentId", comment.id),
    );
    expect(conflict.status).toBe(409);
    expect((await readError(conflict)).error.code).toBe("VERSION_CONFLICT");

    // 作者本人编辑 → 200
    const edited = await commentRoute.PATCH(
      buildRequest("PATCH", `${BASE}/comments/${comment.id}`, {
        cookie: cookieMember,
        body: { expectedVersion: 1, body: "作者改好了" },
      }),
      ctx("commentId", comment.id),
    );
    expect(edited.status).toBe(200);
    const editedBody = CommentSuccess.parse((await edited.json()) as unknown);
    expect(editedBody.data.body).toBe("作者改好了");
    expect(editedBody.data.version).toBe(2);
  });

  it("DELETE /comments/{commentId}：400缺expectedVersion/409冲突/200+删除占位（C1）/再次删除404", async () => {
    const idempotencyKey = randomUUID();
    const created = await taskCommentsRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${activeTaskId}/comments`, {
        cookie: cookieMember,
        body: { body: "待删除评论正文" },
        idempotencyKey,
      }),
      ctx("taskId", activeTaskId),
    );
    const { data: comment } = CommentSuccess.parse((await created.json()) as unknown);

    const missingVersion = await commentRoute.DELETE(
      buildRequest("DELETE", `${BASE}/comments/${comment.id}`, { cookie: cookieMember }),
      ctx("commentId", comment.id),
    );
    expect(missingVersion.status).toBe(400);

    const conflict = await commentRoute.DELETE(
      buildRequest("DELETE", `${BASE}/comments/${comment.id}?expectedVersion=99`, {
        cookie: cookieMember,
      }),
      ctx("commentId", comment.id),
    );
    expect(conflict.status).toBe(409);

    // C1 修复验收：200 + 删除占位 Comment（body=null、isDeleted=true、version 递增），
    // 严格契约 schema 校验（strictObject：多字段即失败）。
    const deleted = await commentRoute.DELETE(
      buildRequest("DELETE", `${BASE}/comments/${comment.id}?expectedVersion=1`, {
        cookie: cookieMember,
      }),
      ctx("commentId", comment.id),
    );
    expect(deleted.status).toBe(200);
    expect(deleted.headers.get("content-type")).toContain("application/json");
    const deletedBody = CommentSuccess.parse((await deleted.json()) as unknown);
    expect(deletedBody.data.body).toBeNull();
    expect(deletedBody.data.isDeleted).toBe(true);
    expect(deletedBody.data.version).toBe(2);

    // 旧创建重放（同一 Idempotency-Key）返回 200 + 删除占位，不泄漏原文（docs/05 §5）。
    const replay = await taskCommentsRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${activeTaskId}/comments`, {
        cookie: cookieMember,
        body: { body: "待删除评论正文" },
        idempotencyKey,
      }),
      ctx("taskId", activeTaskId),
    );
    expect(replay.status).toBe(200);
    const replayBody = CommentSuccess.parse((await replay.json()) as unknown);
    expect(replayBody.data.id).toBe(comment.id);
    expect(replayBody.data.isDeleted).toBe(true);
    expect(replayBody.data.body).toBeNull();
  });

  it("已软删除评论再次编辑/删除 → 404（占位不可操作）", async () => {
    const created = await taskCommentsRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${activeTaskId}/comments`, {
        cookie: cookieMember,
        body: { body: "第二次删除" },
        idempotencyKey: randomUUID(),
      }),
      ctx("taskId", activeTaskId),
    );
    const { data: comment } = CommentSuccess.parse((await created.json()) as unknown);
    await commentRoute.DELETE(
      buildRequest("DELETE", `${BASE}/comments/${comment.id}?expectedVersion=1`, {
        cookie: cookieMember,
      }),
      ctx("commentId", comment.id),
    );
    const reDelete = await commentRoute.DELETE(
      buildRequest("DELETE", `${BASE}/comments/${comment.id}?expectedVersion=2`, {
        cookie: cookieOwner,
      }),
      ctx("commentId", comment.id),
    );
    expect(reDelete.status).toBe(404);
  });
});

/* ── 子任务路由矩阵 ───────────────────────────────────────────────────── */

describe("子任务路由（HTTP 层矩阵，E1）", () => {
  it("GET/POST：401 未认证、404 局外、201 成员创建、400 非法表单", async () => {
    const noAuth = await taskSubtasksRoute.GET(
      buildRequest("GET", `${BASE}/tasks/${activeTaskId}/subtasks`, { cookie: null }),
      ctx("taskId", activeTaskId),
    );
    expect(noAuth.status).toBe(401);

    const outsider = await taskSubtasksRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${activeTaskId}/subtasks`, {
        cookie: cookieOutsider,
        body: { title: "局外子任务" },
        idempotencyKey: randomUUID(),
      }),
      ctx("taskId", activeTaskId),
    );
    expect(outsider.status).toBe(404);

    const badForm = await taskSubtasksRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${activeTaskId}/subtasks`, {
        cookie: cookieMember,
        body: { wrong: "shape" },
        idempotencyKey: randomUUID(),
      }),
      ctx("taskId", activeTaskId),
    );
    expect(badForm.status).toBe(400);

    const created = await taskSubtasksRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${activeTaskId}/subtasks`, {
        cookie: cookieMember,
        body: { title: "成员子任务" },
        idempotencyKey: randomUUID(),
      }),
      ctx("taskId", activeTaskId),
    );
    expect(created.status).toBe(201);
    const body = SubtaskSuccess.parse((await created.json()) as unknown);
    expect(body.data.title).toBe("成员子任务");
  });

  it("PATCH/DELETE /subtasks/{subtaskId}：404 非法UUID、409 冲突、200 完成、204 删除、404 再删", async () => {
    const created = await taskSubtasksRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${activeTaskId}/subtasks`, {
        cookie: cookieMember,
        body: { title: "待改子任务" },
        idempotencyKey: randomUUID(),
      }),
      ctx("taskId", activeTaskId),
    );
    const { data: subtask } = SubtaskSuccess.parse((await created.json()) as unknown);

    const badUuid = await subtaskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/subtasks/not-a-uuid`, {
        cookie: cookieMember,
        body: { expectedVersion: 1, title: "x" },
      }),
      ctx("subtaskId", "not-a-uuid"),
    );
    expect(badUuid.status).toBe(404);

    const conflict = await subtaskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/subtasks/${subtask.id}`, {
        cookie: cookieMember,
        body: { expectedVersion: 42, title: "过期" },
      }),
      ctx("subtaskId", subtask.id),
    );
    expect(conflict.status).toBe(409);

    const done = await subtaskRoute.PATCH(
      buildRequest("PATCH", `${BASE}/subtasks/${subtask.id}`, {
        cookie: cookieMember,
        body: { expectedVersion: 1, isCompleted: true },
      }),
      ctx("subtaskId", subtask.id),
    );
    expect(done.status).toBe(200);

    const deleted = await subtaskRoute.DELETE(
      buildRequest("DELETE", `${BASE}/subtasks/${subtask.id}?expectedVersion=2`, {
        cookie: cookieMember,
      }),
      ctx("subtaskId", subtask.id),
    );
    expect(deleted.status).toBe(204);

    const reDelete = await subtaskRoute.DELETE(
      buildRequest("DELETE", `${BASE}/subtasks/${subtask.id}?expectedVersion=2`, {
        cookie: cookieMember,
      }),
      ctx("subtaskId", subtask.id),
    );
    expect(reDelete.status).toBe(404);
  });
});

/* ── 附件路由矩阵（不含真实上传，上传/415 由 attachment-quota 套件覆盖）──── */

describe("附件路由（HTTP 层矩阵，E1）", () => {
  it("GET /tasks/{taskId}/attachments：401 / 404 局外与非法UUID / 200 成员", async () => {
    const noAuth = await taskAttachmentsRoute.GET(
      buildRequest("GET", `${BASE}/tasks/${activeTaskId}/attachments`, { cookie: null }),
      ctx("taskId", activeTaskId),
    );
    expect(noAuth.status).toBe(401);

    const outsider = await taskAttachmentsRoute.GET(
      buildRequest("GET", `${BASE}/tasks/${activeTaskId}/attachments`, { cookie: cookieOutsider }),
      ctx("taskId", activeTaskId),
    );
    expect(outsider.status).toBe(404);

    const badUuid = await taskAttachmentsRoute.GET(
      buildRequest("GET", `${BASE}/tasks/not-a-uuid/attachments`, { cookie: cookieMember }),
      ctx("taskId", "not-a-uuid"),
    );
    expect(badUuid.status).toBe(404);

    const member = await taskAttachmentsRoute.GET(
      buildRequest("GET", `${BASE}/tasks/${activeTaskId}/attachments`, { cookie: cookieMember }),
      ctx("taskId", activeTaskId),
    );
    expect(member.status).toBe(200);
  });

  it("POST 非multipart表单 → 400 VALIDATION_ERROR（不进入存储层）", async () => {
    const res = await taskAttachmentsRoute.POST(
      buildRequest("POST", `${BASE}/tasks/${activeTaskId}/attachments`, {
        cookie: cookieMember,
        body: { notMultipart: true },
      }),
      ctx("taskId", activeTaskId),
    );
    expect(res.status).toBe(400);
  });

  it("DELETE /attachments/{attachmentId}：401 / 404 非法UUID与未知ID", async () => {
    const noAuth = await attachmentRoute.DELETE(
      buildRequest("DELETE", `${BASE}/attachments/${randomUUID()}?expectedVersion=1`, {
        cookie: null,
      }),
      ctx("attachmentId", randomUUID()),
    );
    expect(noAuth.status).toBe(401);

    const badUuid = await attachmentRoute.DELETE(
      buildRequest("DELETE", `${BASE}/attachments/not-a-uuid?expectedVersion=1`, {
        cookie: cookieMember,
      }),
      ctx("attachmentId", "not-a-uuid"),
    );
    expect(badUuid.status).toBe(404);

    const unknown = await attachmentRoute.DELETE(
      buildRequest("DELETE", `${BASE}/attachments/${randomUUID()}?expectedVersion=1`, {
        cookie: cookieMember,
      }),
      ctx("attachmentId", randomUUID()),
    );
    expect(unknown.status).toBe(404);
  });
});

/* ── 撤销邀请非法 UUID（C3 修复验收）──────────────────────────────────── */

describe("撤销邀请路径参数校验（C3）", () => {
  it("非法 projectId / invitationId / 混合大小写未知ID → 404（无500）", async () => {
    const badProject = await invitationRoute.DELETE(
      buildRequest("DELETE", `${BASE}/projects/not-a-uuid/invitations/${randomUUID()}`, {
        cookie: cookieOwner,
      }),
      ctx("invitationId", randomUUID(), { projectId: "not-a-uuid" }),
    );
    expect(badProject.status).toBe(404);

    const badInvitation = await invitationRoute.DELETE(
      buildRequest("DELETE", `${BASE}/projects/${projectId}/invitations/not-a-uuid`, {
        cookie: cookieOwner,
      }),
      ctx("invitationId", "not-a-uuid", { projectId }),
    );
    expect(badInvitation.status).toBe(404);

    // 混合大小写合法 UUID（未知邀请）→ 仍 404，不触发参数解析 500。
    const uppercaseUnknown = randomUUID().toUpperCase();
    const unknown = await invitationRoute.DELETE(
      buildRequest("DELETE", `${BASE}/projects/${projectId}/invitations/${uppercaseUnknown}`, {
        cookie: cookieOwner,
      }),
      ctx("invitationId", uppercaseUnknown, { projectId }),
    );
    expect(unknown.status).toBe(404);

    // 局外用户对合法参数 → 404（非成员不可见，同时证明没有把授权检查前置短路成 403 泄露）。
    const outsider = await invitationRoute.DELETE(
      buildRequest("DELETE", `${BASE}/projects/${projectId}/invitations/${randomUUID()}`, {
        cookie: cookieOutsider,
      }),
      ctx("invitationId", randomUUID(), { projectId }),
    );
    expect(outsider.status).toBe(404);
  });
});
