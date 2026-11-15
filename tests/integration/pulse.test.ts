import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { hashPassword } from "better-auth/crypto";
import { ErrorResponseSchema, PulseSchema, SuccessResponseSchema } from "@/contracts";
import { prisma } from "@/server/db/prisma";
import { withTransaction, lockProjectRow } from "@/server/db/tx";
import { appendActivity } from "@/server/modules/activity/writer";
import { uploadAttachment } from "@/server/modules/attachments/service";
import { createComment, deleteComment, updateComment } from "@/server/modules/comments/service";
import { acceptInvitation, createInvitation, revokeInvitation } from "@/server/modules/invitation/service";
import { updateProject } from "@/server/modules/project";
import { getPulse } from "@/server/modules/pulse/service";
import * as storage from "@/server/modules/storage/client";
import { createSubtask, deleteSubtask, updateSubtask } from "@/server/modules/subtask/service";
import { createTask, moveTask, restoreTask, softDeleteTask, updateTask } from "@/server/modules/task";
import { removeMember } from "@/server/services/member.service";
import { m5Fixture } from "../support/m5-fixture";

/**
 * GET /my/pulse：变更探测（docs/05 §6）。真实 PostgreSQL 上验证：
 *  - 没有写入时标记稳定；任何成员可见的写入都会改变该项目的标记和总标记；
 *  - 标记只反映调用者可访问的项目，别人的写入不影响无关用户；
 *  - 排队等锁、后提交的写入同样推进标记（revision 在锁内递增，不依赖时间戳）；
 *  - 路由的 ETag / If-None-Match / 401。
 */

let f: Awaited<ReturnType<typeof m5Fixture>>;
beforeEach(async () => {
  f = await m5Fixture();
  // 夹具直接插入了编号 1 的任务；让计数器与之对齐，createTask 才能继续取号。
  await prisma.project.update({ where: { id: f.projectId }, data: { nextTaskNumber: 2 } });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await f.cleanup();
});

/** 调用者视角下本夹具项目的标记；项目不可见时为 undefined。 */
async function projectToken(userId: string): Promise<string | undefined> {
  return (await getPulse(userId)).projects.find((project) => project.id === f.projectId)?.token;
}

/** 执行一次写入，断言成员看到的项目标记与总标记都变了，无关用户的标记不变。 */
async function expectAdvance<T>(label: string, write: () => Promise<T>): Promise<T> {
  const [memberBefore, outsiderBefore] = await Promise.all([getPulse(f.member), getPulse(f.outsider)]);
  const result = await write();
  const [memberAfter, outsiderAfter] = await Promise.all([getPulse(f.member), getPulse(f.outsider)]);
  const pick = (pulse: typeof memberBefore) => pulse.projects.find((project) => project.id === f.projectId)?.token;
  expect(pick(memberAfter), `${label}: project token`).not.toBe(pick(memberBefore));
  expect(memberAfter.token, `${label}: overall token`).not.toBe(memberBefore.token);
  expect(outsiderAfter, `${label}: unrelated user`).toEqual(outsiderBefore);
  return result;
}

describe("getPulse on real PostgreSQL", () => {
  it("is stable without writes, valid against the contract, and scoped to accessible projects", async () => {
    const first = await getPulse(f.member);
    expect(PulseSchema.safeParse(first).success).toBe(true);
    expect(await getPulse(f.member)).toEqual(first);
    expect(first.projects.map((project) => project.id)).toEqual([f.projectId]);
    // owner 与成员看到同一个项目；外部用户的名单是空的，也拿不到这个项目的标记。
    expect((await getPulse(f.owner)).projects.map((project) => project.id)).toEqual([f.projectId]);
    expect((await getPulse(f.outsider)).projects).toEqual([]);
    expect(await projectToken(f.outsider)).toBeUndefined();
  });

  it("every task write advances the project token; a no-op update does not", async () => {
    const created = await expectAdvance("create", () =>
      createTask(f.projectId, f.member, { title: "探测任务" }, randomUUID()),
    );
    let task = created.task;
    task = await expectAdvance("update", () =>
      updateTask(task.id, f.member, { expectedVersion: task.version, title: "探测任务（改）" }),
    );

    const before = await getPulse(f.member);
    await updateTask(task.id, f.member, { expectedVersion: task.version, title: task.title });
    expect(await getPulse(f.member)).toEqual(before);

    const boardVersion = (await prisma.project.findUniqueOrThrow({ where: { id: f.projectId } })).boardVersion;
    const moved = await expectAdvance("move", () =>
      moveTask(task.id, f.member, {
        expectedVersion: task.version,
        expectedBoardVersion: boardVersion,
        toStatus: "IN_PROGRESS",
        beforeTaskId: null,
      }),
    );
    const deleted = await expectAdvance("delete", () => softDeleteTask(task.id, f.member, moved.task.version));
    await expectAdvance("restore", () =>
      restoreTask(task.id, f.member, { expectedVersion: deleted.version }, randomUUID()),
    );
  });

  it("subtask and comment writes advance the project token", async () => {
    const subtask = (await expectAdvance("subtask create", () =>
      createSubtask(f.taskId, f.member, { title: "清单项" }, randomUUID()),
    )).subtask;
    const toggled = await expectAdvance("subtask update", () =>
      updateSubtask(subtask.id, f.owner, { expectedVersion: subtask.version, isCompleted: true }),
    );
    await expectAdvance("subtask delete", () => deleteSubtask(subtask.id, f.member, toggled.version));

    const comment = (await expectAdvance("comment create", () =>
      createComment(f.taskId, f.member, { body: "讨论" }, randomUUID()),
    )).comment;
    const edited = await expectAdvance("comment update", () =>
      updateComment(comment.id, f.member, { expectedVersion: comment.version, body: "讨论（改）" }),
    );
    await expectAdvance("comment delete", () => deleteComment(comment.id, f.owner, edited.version));
  });

  it("attachment reservation, failure and completion all advance the project token", async () => {
    const data = Buffer.from("pulse attachment");
    const upload = () =>
      uploadAttachment(
        f.taskId,
        f.member,
        { uploadId: randomUUID(), declaredSizeBytes: data.length, sha256: createHash("sha256").update(data).digest("hex") },
        { fileName: "pulse.txt", mimeType: "text/plain", stream: Readable.from([data]) },
        { signal: AbortSignal.timeout(120000) },
      );

    // 预留与失败都不写活动日志，但会改变项目的预留字节数。
    const idle = await projectToken(f.member);
    let reserved: string | undefined;
    vi.spyOn(storage, "putFile").mockImplementationOnce(async () => {
      reserved = await projectToken(f.member);
      throw new Error("synthetic storage failure");
    });
    await expect(upload()).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    const failed = await projectToken(f.member);
    expect(reserved).toBeDefined();
    expect(new Set([idle, reserved, failed]).size).toBe(3);

    vi.spyOn(storage, "putFile").mockImplementationOnce(async () => undefined);
    const ready = await expectAdvance("upload", upload);
    expect(ready.attachment.state).toBe("READY");
  });

  it("membership and project changes advance the token and change who can see the project", async () => {
    // 邀请的创建与撤销不写活动，但 owner 的邀请列表会变。
    const invitation = await expectAdvance("invitation create", () =>
      createInvitation(f.owner, f.projectId, randomUUID()),
    );
    expect(invitation.data.token).toBeTruthy();
    const second = await createInvitation(f.owner, f.projectId, randomUUID());
    await expectAdvance("invitation revoke", () => revokeInvitation(second.data.invitation.id, f.projectId, f.owner));

    // 外部用户接受邀请：他开始看到项目，侧栏标记也随之改变。
    const outsiderBefore = await getPulse(f.outsider);
    const ownerBefore = await projectToken(f.owner);
    await acceptInvitation(invitation.data.token!, f.outsider);
    const outsiderAfter = await getPulse(f.outsider);
    expect(outsiderAfter.projects.map((project) => project.id)).toEqual([f.projectId]);
    expect(outsiderAfter.shell).not.toBe(outsiderBefore.shell);
    expect(outsiderAfter.token).not.toBe(outsiderBefore.token);
    expect(await projectToken(f.owner)).not.toBe(ownerBefore);

    // 移除成员：owner 的标记前进；被移除者不再看到项目。
    const ownerMid = await projectToken(f.owner);
    const memberBefore = await getPulse(f.member);
    await removeMember({ projectId: f.projectId, requesterId: f.owner, targetUserId: f.member });
    const memberAfter = await getPulse(f.member);
    expect(memberAfter.projects).toEqual([]);
    expect(memberAfter.shell).not.toBe(memberBefore.shell);
    expect(await projectToken(f.owner)).not.toBe(ownerMid);

    // 成员自己退出（MEMBER_LEFT）同样如此。
    const ownerBeforeLeave = await projectToken(f.owner);
    await removeMember({ projectId: f.projectId, requesterId: f.outsider, targetUserId: f.outsider });
    expect((await getPulse(f.outsider)).projects).toEqual([]);
    expect(await projectToken(f.owner)).not.toBe(ownerBeforeLeave);

    // 项目资料与归档。
    const project = await prisma.project.findUniqueOrThrow({ where: { id: f.projectId } });
    const shellBefore = (await getPulse(f.owner)).shell;
    const tokenBefore = await projectToken(f.owner);
    const renamed = await updateProject(f.projectId, f.owner, { expectedVersion: project.version, name: "改名后的项目" });
    expect((await getPulse(f.owner)).shell).not.toBe(shellBefore);
    expect(await projectToken(f.owner)).not.toBe(tokenBefore);
    const tokenRenamed = await projectToken(f.owner);
    await updateProject(f.projectId, f.owner, { expectedVersion: renamed.version, archived: true });
    expect(await projectToken(f.owner)).not.toBe(tokenRenamed);
    // 归档项目仍在名单里（成员仍可阅读）。
    expect((await getPulse(f.owner)).projects.map((item) => item.id)).toEqual([f.projectId]);
  });

  it("a member's profile change advances the tokens of the projects they belong to", async () => {
    const before = await projectToken(f.owner);
    await prisma.user.update({ where: { id: f.member }, data: { name: "改名的成员" } });
    expect(await projectToken(f.owner)).not.toBe(before);
  });

  it("a writer that queued on the project lock still advances the token when it commits last", async () => {
    // 事务甲先开始（时间戳更早），却在事务乙提交之后才拿到项目锁并写入活动。
    // 以活动时间戳为准的探测会漏掉甲；revision 在锁内递增，不会。
    let releaseFirst!: () => void;
    const firstMayWrite = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstStarted!: () => void;
    const firstHasStarted = new Promise<void>((resolve) => { firstStarted = resolve; });
    const entry = { projectId: f.projectId, actorId: f.owner, entityType: "TASK", entityId: f.taskId, action: "TASK_UPDATED" } as const;

    const first = withTransaction(async (tx) => {
      await tx.$queryRaw`SELECT 1`; // 事务甲的开始时间早于乙
      firstStarted();
      await firstMayWrite;
      await lockProjectRow(tx, f.projectId);
      await appendActivity(tx, entry);
    });
    await firstHasStarted;
    await withTransaction(async (tx) => {
      await lockProjectRow(tx, f.projectId);
      await appendActivity(tx, entry);
    });
    const afterSecond = await projectToken(f.member);
    releaseFirst();
    await first;
    expect(await projectToken(f.member)).not.toBe(afterSecond);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: f.projectId } })).revision).toBe(2);
  });
});

describe("GET /api/v1/my/pulse", () => {
  it("requires a session, returns the pulse with an ETag, and answers a matching If-None-Match with 304", async () => {
    const password = "Synthetic-Pulse-Route-2026!";
    await prisma.account.create({
      data: { userId: f.member, accountId: f.member, providerId: "credential", password: await hashPassword(password) },
    });
    const { auth } = await import("@/server/auth");
    const { GET } = await import("@/app/api/v1/my/pulse/route");
    const member = await prisma.user.findUniqueOrThrow({ where: { id: f.member } });
    const login = await auth.api.signInEmail({ body: { email: member.email, password }, asResponse: true });
    expect(login.status).toBe(200);
    const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const url = "http://localhost:3000/api/v1/my/pulse";
    const call = (headers: Record<string, string> = {}) => GET(new Request(url, { headers: { cookie, ...headers } }));

    const anonymous = await GET(new Request(url));
    expect(anonymous.status).toBe(401);
    expect(ErrorResponseSchema.parse(await anonymous.json()).error.code).toBe("UNAUTHENTICATED");
    expect(anonymous.headers.get("etag")).toBeNull();

    const fresh = await call();
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get("cache-control")).toBe("private, no-store");
    const body = SuccessResponseSchema(PulseSchema).parse(await fresh.json());
    const etag = fresh.headers.get("etag");
    expect(etag).toBe(`"${body.data.token}"`);
    expect(body.data.projects.map((project) => project.id)).toEqual([f.projectId]);
    expect(body.meta.requestId).toBe(fresh.headers.get("x-request-id"));

    for (const condition of [etag!, `W/${etag}`, `"stale", ${etag}`, "*"]) {
      const unchanged = await call({ "if-none-match": condition });
      expect(unchanged.status, condition).toBe(304);
      expect(unchanged.headers.get("etag")).toBe(etag);
      expect(unchanged.headers.get("cache-control")).toBe("private, no-store");
      expect(await unchanged.text()).toBe("");
    }

    await createTask(f.projectId, f.owner, { title: "别人新建的任务" }, randomUUID());
    const changed = await call({ "if-none-match": etag! });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
  });
});
