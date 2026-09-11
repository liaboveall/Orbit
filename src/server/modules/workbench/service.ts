import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import {
  OverviewSchema,
  MyTasksQuerySchema,
  type MyTasksQueryDTO,
} from "@/contracts";
import { dateInTimezone } from "@/lib/calendar";
import { registrationTimezone } from "@/server/auth/user-fields";
import { fromDueDateString } from "@/server/modules/task/date-only";
import {
  toTaskSummaryDTO,
  fetchTaskResourceCountsBatch,
} from "@/server/modules/task/mappers";
import {
  keysetCondition,
  orderByFor,
  sortValuesFor,
  type TaskListResult,
} from "@/server/modules/task/read";
import {
  computeFilterFingerprint,
  decodeCursor,
  encodeCursor,
} from "@/server/modules/pagination/cursor";
import { DomainError } from "@/server/http/errors";

async function calendar(userId: string, now: Date) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const timezone = registrationTimezone(user?.timezone),
    today = dateInTimezone(timezone, now);
  const date = fromDueDateString(today),
    end = new Date(date);
  end.setUTCDate(end.getUTCDate() + 7);
  return { timezone, today, date, end };
}
const membership = (userId: string): Prisma.ProjectWhereInput => ({
  archivedAt: null,
  OR: [{ ownerId: userId }, { members: { some: { userId } } }],
});
export async function getOverview(userId: string, now = new Date()) {
  const { timezone, today, date, end } = await calendar(userId, now);
  const rows = await prisma.$queryRaw<
    Array<{
      overdue: bigint;
      dueToday: bigint;
      upcoming: bigint;
      inProgress: bigint;
      totalOpen: bigint;
    }>
  >`
    SELECT COUNT(*) FILTER (WHERE t."dueDate" < ${date}::date) AS overdue,
      COUNT(*) FILTER (WHERE t."dueDate" = ${date}::date) AS "dueToday",
      COUNT(*) FILTER (WHERE t."dueDate" > ${date}::date AND t."dueDate" <= ${end}::date) AS upcoming,
      COUNT(*) FILTER (WHERE t.status = 'IN_PROGRESS') AS "inProgress",COUNT(*) AS "totalOpen"
    FROM "Task" t JOIN "Project" p ON p.id=t."projectId"
    WHERE t."assigneeId"=${userId} AND t."deletedAt" IS NULL AND t.status <> 'DONE'
      AND p."archivedAt" IS NULL AND (p."ownerId"=${userId} OR EXISTS(
        SELECT 1 FROM "ProjectMember" m WHERE m."projectId"=p.id AND m."userId"=${userId}))
  `;
  const c = rows[0]!;
  return OverviewSchema.parse({
    timezone,
    today,
    overdue: Number(c.overdue),
    dueToday: Number(c.dueToday),
    upcoming: Number(c.upcoming),
    inProgress: Number(c.inProgress),
    totalOpen: Number(c.totalOpen),
  });
}
export async function listMyTasks(
  userId: string,
  input: MyTasksQueryDTO = {},
  now = new Date(),
): Promise<TaskListResult> {
  const parsed = MyTasksQuerySchema.safeParse(input);
  if (!parsed.success)
    throw new DomainError("VALIDATION_ERROR", "任务筛选参数不合法。");
  const query = parsed.data,
    { today, date, end } = await calendar(userId, now);
  const bucket = query.bucket ?? "all_open",
    sort = query.sort ?? "updated_desc",
    limit = query.limit ?? 30;
  const filters: Prisma.TaskWhereInput[] = [
    {
      assigneeId: userId,
      deletedAt: null,
      project: membership(userId),
      status: bucket === "done" ? "DONE" : { not: "DONE" },
    },
  ];
  if (bucket === "overdue") filters.push({ dueDate: { lt: date } });
  if (bucket === "today") filters.push({ dueDate: date });
  if (bucket === "upcoming") filters.push({ dueDate: { gt: date, lte: end } });
  if (bucket === "in_progress") filters.push({ status: "IN_PROGRESS" });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.priority) filters.push({ priority: query.priority });
  if (query.q)
    filters.push({
      title: {
        contains: query.q.replace(/[\\%_]/g, (c) => "\\" + c),
        mode: "insensitive",
      },
    });
  const fingerprint = computeFilterFingerprint({
    userId,
    today,
    bucket,
    sort,
    projectId: query.projectId ?? null,
    priority: query.priority ?? null,
    q: query.q ?? "",
  });
  if (query.cursor)
    filters.push(
      keysetCondition(sort, decodeCursor(query.cursor, fingerprint)),
    );
  const rows = await prisma.task.findMany({
    where: { AND: filters },
    orderBy: orderByFor(sort),
    take: limit + 1,
    include: {
      project: { select: { key: true } },
      assignee: { select: { id: true, name: true } },
      creator: { select: { id: true, name: true } },
    },
  });
  const page = rows.slice(0, limit),
    counts = await fetchTaskResourceCountsBatch(
      prisma,
      page.map((t) => t.id),
    );
  const tasks = await Promise.all(
    page.map((t) =>
      toTaskSummaryDTO(t, { projectKey: t.project.key }, counts.get(t.id)!),
    ),
  );
  const last = tasks.at(-1),
    hasMore = rows.length > limit;
  return {
    tasks,
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeCursor(sortValuesFor(sort, last), last.id, fingerprint)
        : null,
  };
}
