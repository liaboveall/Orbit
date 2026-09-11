import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import {
  createSubtask,
  listSubtasks,
  updateSubtask,
  deleteSubtask,
} from "@/server/modules/subtask/service";
import {
  createComment,
  listComments,
  updateComment,
  deleteComment,
} from "@/server/modules/comments/service";
import { m5Fixture } from "../support/m5-fixture";
let f: Awaited<ReturnType<typeof m5Fixture>>;
beforeEach(async () => {
  f = await m5Fixture();
});
afterEach(async () => {
  await f.cleanup();
});
const sub = (user = f.member, key = randomUUID()) =>
  createSubtask(f.taskId, user, { title: "协作清单" }, key);
const comment = (user = f.member, key = randomUUID()) =>
  createComment(
    f.taskId,
    user,
    { body: "纯文本 <script>alert(1)</script>" },
    key,
  );
describe("M5 subresources on real PostgreSQL", () => {
  it("members edit subtasks, independent version conflicts and idempotent replay", async () => {
    const before = await prisma.task.findUniqueOrThrow({
        where: { id: f.taskId },
      }),
      key = randomUUID();
    const [a, b] = await Promise.all([sub(f.member, key), sub(f.member, key)]);
    expect(a.subtask.id).toBe(b.subtask.id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const edited = await updateSubtask(a.subtask.id, f.owner, {
      expectedVersion: 1,
      isCompleted: true,
    });
    expect(edited.version).toBe(2);
    expect(edited.isCompleted).toBe(true);
    await expect(
      updateSubtask(a.subtask.id, f.member, {
        expectedVersion: 1,
        title: "stale",
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const after = await prisma.task.findUniqueOrThrow({
      where: { id: f.taskId },
    });
    expect(after.version).toBe(before.version);
    expect(after.updatedAt.getTime()).toBeGreaterThan(
      before.updatedAt.getTime(),
    );
    await deleteSubtask(a.subtask.id, f.member, 2);
    expect(await listSubtasks(f.taskId, f.owner)).toEqual([]);
  });
  it("serializes concurrent creates at 50 subtasks and releases deleted quota", async () => {
    await prisma.subtask.createMany({
      data: Array.from({ length: 49 }, (_, i) => ({
        taskId: f.taskId,
        title: `seed ${i}`,
      })),
    });
    const results = await Promise.allSettled([sub(), sub()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "LIMIT_EXCEEDED" },
    });
    const rows = await listSubtasks(f.taskId, f.member);
    expect(rows).toHaveLength(50);
    await deleteSubtask(rows[0]!.id, f.member, 1);
    await sub();
    expect(await listSubtasks(f.taskId, f.owner)).toHaveLength(50);
  });
  it("enforces author-only edits and author/owner deletes; deleted comments keep safe placeholders", async () => {
    const { comment: c } = await comment();
    await expect(
      updateComment(c.id, f.owner, { expectedVersion: 1, body: "owner edit" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const own = await comment(f.owner);
    await expect(
      deleteComment(own.comment.id, f.member, 1),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await updateComment(c.id, f.member, { expectedVersion: 1, body: "修改" });
    await expect(deleteComment(c.id, f.owner, 1)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    const deleted = await deleteComment(c.id, f.owner, 2);
    expect(deleted.isDeleted).toBe(true);
    expect(deleted.body).toBeNull();
    expect((await listComments(f.taskId, f.member, {})).comments).toHaveLength(
      2,
    );
    expect(
      await prisma.comment.findUniqueOrThrow({ where: { id: c.id } }),
    ).toMatchObject({ body: "" });
  });
  it("replays lost comment response once and rejects changed payload", async () => {
    const key = randomUUID(),
      [a, b] = await Promise.all([
        comment(f.member, key),
        comment(f.member, key),
      ]);
    expect(a.comment.id).toBe(b.comment.id);
    expect(await prisma.comment.count({ where: { taskId: f.taskId } })).toBe(1);
    await expect(
      createComment(f.taskId, f.member, { body: "changed" }, key),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("paginates stable timestamp ties without gaps or duplicates and rejects another task cursor", async () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    await prisma.comment.createMany({
      data: Array.from({ length: 65 }, (_, i) => ({
        taskId: f.taskId,
        authorId: f.member,
        body: `comment ${i}`,
        createdAt,
      })),
    });
    const first = await listComments(f.taskId, f.member, { limit: 30 });
    expect(first.comments).toHaveLength(30);
    const second = await listComments(f.taskId, f.member, {
      limit: 30,
      cursor: first.nextCursor!,
    });
    const third = await listComments(f.taskId, f.member, {
      limit: 30,
      cursor: second.nextCursor!,
    });
    expect(third.hasMore).toBe(false);
    expect(
      new Set(
        [...first.comments, ...second.comments, ...third.comments].map(
          (c) => c.id,
        ),
      ).size,
    ).toBe(65);
    const other = await prisma.task.create({
      data: {
        projectId: f.projectId,
        number: 2,
        creatorId: f.owner,
        title: "other",
        position: 2048n,
      },
    });
    await expect(
      listComments(other.id, f.member, { cursor: first.nextCursor! }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
  it("serializes comment quota at 1000 and reclaims deleted slots", async () => {
    await prisma.comment.createMany({
      data: Array.from({ length: 999 }, () => ({
        taskId: f.taskId,
        authorId: f.member,
        body: "seed",
      })),
    });
    const results = await Promise.allSettled([comment(), comment()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "LIMIT_EXCEEDED" },
    });
    const row = await prisma.comment.findFirstOrThrow({
      where: { taskId: f.taskId },
    });
    await deleteComment(row.id, f.owner, 1);
    await comment();
    expect(
      await prisma.comment.count({
        where: { taskId: f.taskId, deletedAt: null },
      }),
    ).toBe(1000);
  });
  for (const state of ["outsider", "removed", "archived", "deleted"] as const)
    it(`enforces ${state} parent state for all subresource operations`, async () => {
      const { subtask: s } = await sub(),
        { comment: c } = await comment();
      let user = f.member;
      if (state === "outsider") user = f.outsider;
      if (state === "removed")
        await prisma.projectMember.deleteMany({
          where: { projectId: f.projectId, userId: f.member },
        });
      if (state === "archived")
        await prisma.project.update({
          where: { id: f.projectId },
          data: { archivedAt: new Date() },
        });
      if (state === "deleted")
        await prisma.task.update({
          where: { id: f.taskId },
          data: { deletedAt: new Date() },
        });
      const code = state === "archived" ? "PROJECT_ARCHIVED" : "NOT_FOUND";
      for (const operation of [
        () => sub(user),
        () => comment(user),
        () => updateSubtask(s.id, user, { expectedVersion: 1, title: "new" }),
        () => deleteSubtask(s.id, user, 1),
        () => updateComment(c.id, user, { expectedVersion: 1, body: "new" }),
        () => deleteComment(c.id, user, 1),
      ])
        await expect(operation()).rejects.toMatchObject({ code });
      if (state === "archived") {
        expect(await listSubtasks(f.taskId, user)).toHaveLength(1);
        expect((await listComments(f.taskId, user, {})).comments).toHaveLength(
          1,
        );
      } else {
        await expect(listSubtasks(f.taskId, user)).rejects.toMatchObject({
          code,
        });
        await expect(listComments(f.taskId, user, {})).rejects.toMatchObject({
          code,
        });
      }
    });
});
