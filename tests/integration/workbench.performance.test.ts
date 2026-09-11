import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const queryLog = vi.hoisted(() => ({ sql: [] as string[] }));
vi.mock("@/server/db/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
    log: [{ emit: "event", level: "query" }],
  });
  client.$on("query", (event) => queryLog.sql.push(event.query));
  return { prisma: client };
});
import { prisma } from "@/server/db/prisma";
import { getOverview, listMyTasks } from "@/server/modules/workbench/service";
import { getBoard } from "@/server/modules/task/board";
import { listProjectTasks } from "@/server/modules/task/read";
import { m5Fixture } from "../support/m5-fixture";
let f: Awaited<ReturnType<typeof m5Fixture>>;
const now = new Date("2026-09-11T16:30:00Z"); // Shanghai Sep12, Los Angeles Sep11.
beforeEach(async () => {
  f = await m5Fixture();
});
afterEach(async () => {
  if (f) await f.cleanup();
});
async function task(n: number, data: Record<string, unknown> = {}) {
  // Fixed typed columns; overrides are explicitly typed by the caller's record below.
  return prisma.task.create({
    data: {
      projectId: f.projectId,
      number: n,
      creatorId: f.owner,
      assigneeId: f.member,
      title: "工作台任务" + n,
      position: BigInt(n * 1024),
      ...data,
    },
  });
}
describe("M5 workbench correctness and measured query counts", () => {
  it("overlapping buckets are not summed; missing dates remain open; DONE excluded", async () => {
    await prisma.task.update({
      where: { id: f.taskId },
      data: { status: "IN_PROGRESS", dueDate: new Date("2026-09-11") },
    });
    await task(2, { dueDate: new Date("2026-09-12") });
    await task(3, { dueDate: new Date("2026-09-19") });
    await task(4); // no due date
    await task(5, {
      status: "DONE",
      completedAt: now,
      dueDate: new Date("2026-09-10"),
    });
    await task(6, { assigneeId: f.owner });
    expect(await getOverview(f.member, now)).toMatchObject({
      today: "2026-09-12",
      overdue: 1,
      dueToday: 1,
      upcoming: 1,
      inProgress: 1,
      totalOpen: 4,
    });
    expect(
      (await listMyTasks(f.member, { bucket: "done" }, now)).tasks,
    ).toHaveLength(1);
    expect(
      (await listMyTasks(f.member, { bucket: "upcoming" }, now)).tasks,
    ).toHaveLength(1);
    expect(
      (await listMyTasks(f.member, { bucket: "all_open" }, now)).tasks,
    ).toHaveLength(4);
  });
  it.each([
    ["America/Los_Angeles", "2026-09-11"],
    ["Asia/Shanghai", "2026-09-12"],
    ["UTC", "2026-09-11"],
  ])("calendar respects %s", async (timezone, today) => {
    await prisma.user.update({ where: { id: f.member }, data: { timezone } });
    expect((await getOverview(f.member, now)).today).toBe(today);
  });
  it("DST and midnight use date-only values", async () => {
    await prisma.user.update({
      where: { id: f.member },
      data: { timezone: "America/New_York" },
    });
    expect(
      (await getOverview(f.member, new Date("2026-03-08T06:59:59Z"))).today,
    ).toBe("2026-03-08");
    expect(
      (await getOverview(f.member, new Date("2026-03-08T07:00:00Z"))).today,
    ).toBe("2026-03-08");
  });
  it("filters archived/deleted tasks and removes access immediately", async () => {
    expect((await getOverview(f.outsider, now)).totalOpen).toBe(0);
    await prisma.task.update({
      where: { id: f.taskId },
      data: { deletedAt: now },
    });
    expect((await getOverview(f.member, now)).totalOpen).toBe(0);
    await prisma.task.update({
      where: { id: f.taskId },
      data: { deletedAt: null },
    });
    await prisma.project.update({
      where: { id: f.projectId },
      data: { archivedAt: now },
    });
    expect((await listMyTasks(f.member, {}, now)).tasks).toHaveLength(0);
    await prisma.project.update({
      where: { id: f.projectId },
      data: { archivedAt: null },
    });
    await prisma.projectMember.deleteMany({
      where: { projectId: f.projectId, userId: f.member },
    });
    expect((await listMyTasks(f.member, {}, now)).tasks).toHaveLength(0);
  });
  it.each(["updated_desc", "due_asc", "priority_desc"] as const)(
    "stable pagination and filter-bound cursors: %s",
    async (sort) => {
      for (let i = 2; i < 8; i++)
        await task(i, {
          dueDate: i % 2 ? new Date("2026-09-15") : null,
          priority: i % 2 ? "HIGH" : "LOW",
        });
      const a = await listMyTasks(f.member, { limit: 3, sort }, now),
        b = await listMyTasks(
          f.member,
          { limit: 3, sort, cursor: a.nextCursor! },
          now,
        );
      expect(new Set([...a.tasks, ...b.tasks].map((t) => t.id)).size).toBe(6);
      await expect(
        listMyTasks(
          f.member,
          { limit: 3, sort, cursor: a.nextCursor!, bucket: "done" },
          now,
        ),
      ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
      await expect(
        listMyTasks(f.outsider, { limit: 3, sort, cursor: a.nextCursor! }, now),
      ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    },
  );
  it("1000 tasks: real query events stay bounded for overview/list/board", async () => {
    await prisma.task.createMany({
      data: Array.from({ length: 999 }, (_, i) => ({
        id: randomUUID(),
        projectId: f.projectId,
        number: i + 2,
        creatorId: f.owner,
        assigneeId: f.member,
        title: "负载任务" + i,
        position: BigInt((i + 2) * 1024),
        status: (["TODO", "IN_PROGRESS", "DONE"] as const)[i % 3]!,
        completedAt: i % 3 === 2 ? now : null,
        dueDate: new Date("2026-09-12"),
      })),
    });
    queryLog.sql = [];
    const overview = await getOverview(f.member, now);
    expect(overview.totalOpen).toBe(667);
    expect(queryLog.sql.length).toBe(2);
    const durations: number[] = [];
    for (let i = 0; i < 10; i++) {
      queryLog.sql = [];
      const start = performance.now();
      expect(
        (await listMyTasks(f.member, { limit: 100 }, now)).tasks,
      ).toHaveLength(100);
      durations.push(performance.now() - start);
      expect(queryLog.sql.length).toBeLessThanOrEqual(8); // Prisma relation includes issue three bounded secondary SELECTs.
    }
    queryLog.sql = [];
    await listProjectTasks(f.projectId, f.member, { limit: 100 });
    expect(queryLog.sql.length).toBeLessThanOrEqual(8);
    queryLog.sql = [];
    await getBoard(f.projectId, f.member);
    expect(queryLog.sql.length).toBeLessThanOrEqual(25);
    const ordered = durations.sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        benchmark: "M5 1000-task list, local sequential 10 samples",
        p95: ordered.at(-1),
        median: ordered[5],
        boardQueries: queryLog.sql.length,
      }),
    );
    expect(ordered.at(-1)).toBeLessThan(1000); // Regression ceiling, not a claim of production p95.
  });
});
