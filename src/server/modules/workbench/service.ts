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
  TASK_SUMMARY_SELECT,
  fetchTaskExtras,
  toTaskSummaryDTO,
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
import { projectVisibleSql } from "@/server/modules/authorization/project-access";

/**
 * 用户时区下的「今天」与未来 7 天边界。调用方已有会话用户时传入其 timezone
 * （会话查询每次都读 User 行，不是缓存），省掉一次只为取时区的查询。
 */
async function calendar(userId: string, now: Date, knownTimezone?: string) {
  const stored =
    knownTimezone ??
    (await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }))?.timezone;
  const timezone = registrationTimezone(stored),
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
export async function getOverview(userId: string, now = new Date(), knownTimezone?: string) {
  const { timezone, today, date, end } = await calendar(userId, now, knownTimezone);
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
      AND p."archivedAt" IS NULL AND ${projectVisibleSql(userId)}
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
  knownTimezone?: string,
): Promise<TaskListResult> {
  const parsed = MyTasksQuerySchema.safeParse(input);
  if (!parsed.success)
    throw new DomainError("VALIDATION_ERROR", "任务筛选参数不合法。");
  const query = parsed.data,
    { today, date, end } = await calendar(userId, now, knownTimezone);
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
    projectId: query.projectId?.toLowerCase() ?? null,
    priority: query.priority ?? null,
    q: query.q ?? "",
  });
  if (query.cursor)
    filters.push(
      keysetCondition(sort, decodeCursor(query.cursor, fingerprint)),
    );
  // F14：工作台摘要使用显式投影，不拉取 description。
  const rows = await prisma.task.findMany({
    where: { AND: filters },
    orderBy: orderByFor(sort),
    take: limit + 1,
    select: TASK_SUMMARY_SELECT,
  });
  // 姓名、计数与各任务所属项目的 key：整页一条语句。
  const page = rows.slice(0, limit),
    extras = await fetchTaskExtras(prisma, page, { withProjectKeys: true });
  const tasks = page.map((t) =>
    toTaskSummaryDTO(t, { projectKey: extras.projectKeys.get(t.projectId) ?? "" }, extras),
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
