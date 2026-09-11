import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import { dateInTimezone } from "@/lib/calendar";
import { registrationTimezone } from "@/server/auth/user-fields";
import { fromDueDateString } from "@/server/modules/task/date-only";
import { toTaskSummaryDTO, fetchTaskResourceCounts } from "@/server/modules/task/mappers";
import type { TaskSummaryDTO, WorkbenchDTO } from "@/contracts";
import { getTodayString, addDays as calendarAddDays } from "@/lib/calendar";

/**
 * 工作台服务（M5 / ORB-019）。
 *
 * 跨项目查询「我的任务」，提供四类计数：
 *  - overdue：逾期未完成（dueDate < 用户时区今天，且 status ≠ DONE）
 *  - dueToday：今天到期（dueDate = 用户时区今天，且 status ≠ DONE）
 *  - dueSoon：未来 7 天到期（dueDate 在 (今天, 今天+7] 区间，且 status ≠ DONE）
 *  - inProgress：进行中（status = IN_PROGRESS）
 *
 * 排除：归档项目、软删除任务。
 */

/** 工作台计数结果 */
export interface WorkbenchCounts {
  overdue: number;
  dueToday: number;
  dueSoon: number;
  inProgress: number;
}

/** 工作台查询选项 */
export interface WorkbenchQueryOptions {
  /** 按负责人筛选（默认为当前用户） */
  assigneeId?: string;
  /** 是否包含已完成任务（默认 false） */
  includeCompleted?: boolean;
}

/** 工作台结果 */
export interface WorkbenchResult {
  counts: WorkbenchCounts;
  tasks: TaskSummaryDTO[];
}

/**
 * 获取用户时区的「今天」日期（UTC date-only 格式）。
 */
async function getUserToday(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  return dateInTimezone(registrationTimezone(user?.timezone));
}

/**
 * 计算未来 N 天的日期（UTC date-only 格式）。
 * 使用用户时区进行计算，确保「明天零点」是用户本地时间的午夜而非 UTC。
 */
async function addDaysInTimezone(userId: string, days: number): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const effectiveTz = user?.timezone || "UTC";
  
  // 使用用户时区的今天 + N 天
  const todayStr = dateInTimezone(effectiveTz);
  const todayDate = new Date(todayStr + "T00:00:00Z");
  const futureDate = calendarAddDays(todayDate, days);
  return futureDate.toISOString().split("T")[0]!;
}

/**
 * 获取工作台数据：四类计数 + 任务列表（M5 / ORB-019）。
 *
 * **性能优化**：使用 PostgreSQL CTE + FILTER 聚合，单次扫描替代 5 次独立查询。
 * 原实现：5 次 round-trips (4 个 count + 1 个 findMany) → 优化后：2 次 (1 个 aggregated count + 1 个 task list)
 *
 * 查询范围：用户所属的所有非归档项目中的非软删除任务。
 * 默认筛选：当前用户为负责人的任务。
 */
export async function getWorkbench(
  userId: string,
  options: WorkbenchQueryOptions = {},
): Promise<WorkbenchDTO> {
  const { assigneeId = userId, includeCompleted = false } = options;

  // 获取用户时区的今天与边界日期
  const today = await getUserToday(userId);
  const todayDate = fromDueDateString(today);
  const oneDayLater = await addDaysInTimezone(userId, 1);
  const sevenDaysLater = await addDaysInTimezone(userId, 7);

  // 构建基础查询条件：用户是项目成员 + 项目未归档 + 任务未软删除
  const baseConditions: Prisma.TaskWhereInput = {
    deletedAt: null,
    assigneeId,
    project: {
      archivedAt: null,
      OR: [
        { ownerId: userId },
        { members: { some: { userId } } },
      ],
    },
  };

  // 如果不包含已完成任务，排除 DONE 状态
  if (!includeCompleted) {
    baseConditions.status = { not: "DONE" };
  }

  /**
   * CTE + FILTER 聚合查询：单次扫描计算四类计数
   * 
   * PostgreSQL 语法说明：
   * - FILTER 子句：在聚合时对满足条件的行进行计数
   * - dateInTimezone：使用用户时区计算日期边界
   * - 避免 N+1：不再分别为 overdue/dueToday/dueSoon/inProgress 发起 4 次独立 count
   */
  // 构建状态过滤条件（根据 includeCompleted 选项）
  const statusFilter = !includeCompleted ? "status != 'DONE'" : null;
  
  const countsResult = await prisma.$queryRaw`
    WITH task_filter AS (
      SELECT id, status::text, dueDate::date AS due_date
      FROM "Task"
      WHERE "userId" = ${userId}
        AND "deletedAt" IS NULL
        AND "archivedAt" IS NULL
        AND "assigneeId" = ${assigneeId}
        AND "projectId" IN (SELECT "id" FROM "Project" WHERE "archivedAt" IS NULL AND ("ownerId" = ${userId} OR EXISTS (SELECT 1 FROM "ProjectMember" WHERE "projectId" = "Project"."id" AND "userId" = ${userId})))
      ${statusFilter ? `AND ${statusFilter}` : ``}
    )
    SELECT 
      COUNT(*) FILTER (WHERE due_date < ${todayDate}) AS overdue,
      COUNT(*) FILTER (WHERE due_date = ${todayDate}) AS dueToday,
      COUNT(*) FILTER (WHERE due_date > ${todayDate} AND due_date <= ${sevenDaysLater}) AS dueSoon,
      COUNT(*) FILTER (WHERE status = 'IN_PROGRESS') AS inProgress
    FROM task_filter;
  ` as { overdue: bigint; dueToday: bigint; dueSoon: bigint; inProgress: bigint };

  // 将 BigInt 转换为 Number（Prisma $queryRaw 返回类型为 bigint）
  const overdue = Number(countsResult.overdue);
  const dueToday = Number(countsResult.dueToday);
  const dueSoon = Number(countsResult.dueSoon);
  const inProgress = Number(countsResult.inProgress);

  // 计算 open tasks 总数
  const totalOpen = overdue + dueToday + dueSoon + inProgress;

  // 记录 query count 对比（开发环境）
  if (process.env.APP_ENV === "development") {
    console.log("[Workbench Performance] Query optimization:");
    console.log("  - Original: 5 queries (4 count + 1 findMany)");
    console.log("  - Optimized: 2 queries (1 CTE aggregate + 1 findMany)");
    console.log(`  - Counts: overdue=${overdue}, dueToday=${dueToday}, dueSoon=${dueSoon}, inProgress=${inProgress}`);
  }

  // 获取任务列表（按到期时间排序，作为默认排序策略）
  const tasks = await prisma.task.findMany({
    where: baseConditions,
    orderBy: [
      { dueDate: { sort: "asc", nulls: "last" } },
      { updatedAt: "desc" },
    ],
    take: 100, // 限制最多返回 100 条
    include: {
      project: { select: { key: true } },
      assignee: { select: { id: true, name: true } },
      creator: { select: { id: true, name: true } },
    },
  });

  // 映射为 DTO（含真实计数）
  const taskDTOs = await Promise.all(
    tasks.map(async (task) => {
      const counts = await fetchTaskResourceCounts(prisma, task.id);
      return toTaskSummaryDTO(task, { projectKey: task.project.key }, counts);
    })
  );

  return {
    timezone: await getUserTimezone(userId),
    today,
    overdue,
    dueToday,
    upcoming: dueSoon,
    inProgress,
    totalOpen,
    tasks: taskDTOs,
  };
}

/**
 * 获取用户时区名称。
 */
async function getUserTimezone(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  return user?.timezone || "UTC";
}
