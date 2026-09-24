import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import { createTask } from "@/server/modules/task/create";
import { updateTask } from "@/server/modules/task/update";
import { getBoard } from "@/server/modules/task/board";
import { removeMember } from "@/server/services/member.service";
import { m5Fixture } from "../support/m5-fixture";

let f: Awaited<ReturnType<typeof m5Fixture>>;
beforeEach(async () => {
  f = await m5Fixture();
  await prisma.project.update({ where: { id: f.projectId }, data: { nextTaskNumber: 2 } });
});
afterEach(async () => { if (f) await f.cleanup(); });

for (const voluntary of [true, false]) {
  for (const count of [0, 2]) {
    it(`${voluntary ? "leaving" : "removing"} member records ${count} unassignments without changing board order version`, async () => {
      if (count === 0) await prisma.task.update({ where: { id: f.taskId }, data: { assigneeId: null } });
      else await createTask(f.projectId, f.owner, { title: "另一项分配", assigneeId: f.member }, randomUUID());
      const before = await prisma.project.findUniqueOrThrow({ where: { id: f.projectId } });
      const tasks = await prisma.task.findMany({ where: { projectId: f.projectId }, select: { id: true, version: true, assigneeId: true } });
      await removeMember({ projectId: f.projectId, requesterId: voluntary ? f.member : f.owner, targetUserId: f.member });
      const events = await prisma.activityLog.findMany({ where: { projectId: f.projectId, action: { in: ["MEMBER_LEFT", "MEMBER_REMOVED"] } } });
      expect(events).toHaveLength(1);
      expect(events[0]?.action).toBe(voluntary ? "MEMBER_LEFT" : "MEMBER_REMOVED");
      expect(events[0]?.metadata).toMatchObject({ targetUserId: f.member, count });
      expect((await prisma.project.findUniqueOrThrow({ where: { id: f.projectId } })).boardVersion).toBe(before.boardVersion);
      for (const task of tasks) {
        const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
        expect(after.assigneeId).toBeNull();
        expect(after.version).toBe(task.version + (task.assigneeId === f.member ? 1 : 0));
      }
    });
  }
}

for (const table of ["ActivityLog", "IdempotencyRecord"] as const) {
  it(`real database failure at ${table} after Task/Project writes rolls back the entire operation`, async () => {
    // Unique trigger/function affect only this fixture; no service or transaction mocks.
    const trigger = "audit_failure_" + randomUUID().replaceAll("-", "");
    const fn = trigger + "_fn";
    const field = table === "ActivityLog" ? "projectId" : "userId";
    const identity = table === "ActivityLog" ? f.projectId : f.owner;
    const before = await prisma.project.findUniqueOrThrow({ where: { id: f.projectId } });
    const snapshot = async () => ({
      project: await prisma.project.findUniqueOrThrow({ where: { id: f.projectId } }),
      tasks: await prisma.task.findMany({ where: { projectId: f.projectId }, orderBy: { id: "asc" } }),
      activities: await prisma.activityLog.count({ where: { projectId: f.projectId } }),
      idempotency: await prisma.idempotencyRecord.count({ where: { userId: f.owner } }),
    });
    const baseline = await snapshot();
    try {
      // All interpolations are fixed enums, UUIDs allocated above or DB integer versions.
      await prisma.$executeRawUnsafe(`CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW."${field}"::text = '${identity}' THEN
          IF EXISTS (SELECT 1 FROM "Task" WHERE "projectId"='${f.projectId}'::uuid AND number=2)
             AND EXISTS (SELECT 1 FROM "Project" WHERE id='${f.projectId}'::uuid AND "nextTaskNumber"=3 AND "boardVersion"=${before.boardVersion + 1}) THEN
            RAISE EXCEPTION 'late_write_failure_verified';
          ELSE RAISE EXCEPTION 'failure_probe_not_reached'; END IF;
        END IF; RETURN NEW; END $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`);
      await expect(createTask(f.projectId, f.owner, { title: "必须完整回滚" }, randomUUID())).rejects.toThrow("late_write_failure_verified");
      expect(await snapshot()).toEqual(baseline);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "${table}"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }
    const retried = await createTask(f.projectId, f.owner, { title: "恢复后成功" }, randomUUID());
    expect(retried.task.number).toBe(2);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: f.projectId } })).boardVersion).toBe(before.boardVersion + 1);
  });
}

it("batched board counts remain isolated by task and page across all three columns", async () => {
  const progress = await createTask(f.projectId, f.owner, { title: "进行中", status: "IN_PROGRESS" }, randomUUID());
  const done = await createTask(f.projectId, f.owner, { title: "已完成", status: "DONE" }, randomUUID());
  await prisma.subtask.createMany({ data: [
    { taskId: f.taskId, title: "待办子项" }, { taskId: progress.task.id, title: "已做子项", isCompleted: true },
  ] });
  await prisma.comment.createMany({ data: [
    { taskId: done.task.id, authorId: f.owner, body: "一" }, { taskId: done.task.id, authorId: f.owner, body: "二" },
    { taskId: f.taskId, authorId: f.owner, body: "", deletedAt: new Date() },
  ] });
  const board = await getBoard(f.projectId, f.member);
  expect(board.columns.find(c => c.status === "TODO")?.items[0]).toMatchObject({ subtaskTotal: 1, subtaskCompleted: 0, commentCount: 0 });
  expect(board.columns.find(c => c.status === "IN_PROGRESS")?.items[0]).toMatchObject({ subtaskTotal: 1, subtaskCompleted: 1, commentCount: 0 });
  expect(board.columns.find(c => c.status === "DONE")?.items[0]).toMatchObject({ subtaskTotal: 0, commentCount: 2 });
  const filtered = await getBoard(f.projectId, f.member, { status: "DONE", limit: 1 });
  expect(filtered.columns).toHaveLength(1); expect(filtered.columns[0]?.items[0]?.commentCount).toBe(2);
  await expect(getBoard(f.projectId, f.outsider)).rejects.toMatchObject({ code: "NOT_FOUND" });
});

describe("filtered board pagination rejects a changed filter set between pages", () => {
  async function highTasks() {
    const a = (await createTask(f.projectId, f.owner, { title: "A", priority: "MEDIUM" }, randomUUID())).task;
    const b = (await createTask(f.projectId, f.owner, { title: "B", priority: "HIGH" }, randomUUID())).task;
    const c = (await createTask(f.projectId, f.owner, { title: "C", priority: "HIGH" }, randomUUID())).task;
    const first = await getBoard(f.projectId, f.owner, { status: "TODO", priority: "HIGH", limit: 1 });
    expect(first.columns[0]!.items.map((task) => task.title)).toEqual(["B"]);
    expect(first.columns[0]!.total).toBe(2);
    return { a, b, c, cursor: first.columns[0]!.nextCursor!, boardVersion: first.boardVersion };
  }

  it("a task entering the already-returned prefix is a BOARD_CONFLICT, not a silently skipped card", async () => {
    const { a, cursor, boardVersion } = await highTasks();
    await updateTask(a.id, f.member, { expectedVersion: a.version, priority: "HIGH" });
    // Field edits keep the ordering version; the filter-set check must catch it on its own.
    expect((await prisma.project.findUniqueOrThrow({ where: { id: f.projectId } })).boardVersion).toBe(boardVersion);
    await expect(getBoard(f.projectId, f.owner, { status: "TODO", priority: "HIGH", limit: 1, cursor }))
      .rejects.toMatchObject({ code: "BOARD_CONFLICT" });
  });

  it("the last returned task leaving the filter is a BOARD_CONFLICT", async () => {
    const { b, cursor } = await highTasks();
    await updateTask(b.id, f.owner, { expectedVersion: b.version, priority: "LOW" });
    await expect(getBoard(f.projectId, f.owner, { status: "TODO", priority: "HIGH", limit: 1, cursor }))
      .rejects.toMatchObject({ code: "BOARD_CONFLICT" });
  });

  it("member removal that clears assignees invalidates an assignee-filtered cursor", async () => {
    await createTask(f.projectId, f.owner, { title: "成员的第二项", assigneeId: f.member }, randomUUID());
    const first = await getBoard(f.projectId, f.owner, { status: "TODO", assigneeId: f.member, limit: 1 });
    expect(first.columns[0]!.total).toBe(2);
    await removeMember({ projectId: f.projectId, requesterId: f.owner, targetUserId: f.member });
    await expect(getBoard(f.projectId, f.owner, { status: "TODO", assigneeId: f.member, limit: 1, cursor: first.columns[0]!.nextCursor! }))
      .rejects.toMatchObject({ code: "BOARD_CONFLICT" });
  });

  it("unrelated edits and changes after the cursor keep continuation consistent without conflicts", async () => {
    const { a, c, cursor } = await highTasks();
    await updateTask(a.id, f.owner, { expectedVersion: a.version, description: "不影响筛选的描述" });
    const next = await getBoard(f.projectId, f.owner, { status: "TODO", priority: "HIGH", limit: 1, cursor });
    expect(next.columns[0]!.items.map((task) => task.title)).toEqual(["C"]);
    await updateTask(c.id, f.owner, { expectedVersion: c.version, priority: "LOW" });
    const after = await getBoard(f.projectId, f.owner, { status: "TODO", priority: "HIGH", limit: 1, cursor });
    expect(after.columns[0]!.items).toEqual([]);
    expect(after.columns[0]!.total).toBe(1);
    expect(after.columns[0]!.nextCursor).toBeNull();
  });
});
