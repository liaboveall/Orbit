import "server-only";
import { dateInTimezone } from "@/lib/calendar";
import { registrationTimezone } from "@/server/auth/user-fields";
import {
  UuidSchema,
  type TaskListQueryDTO,
  type TaskDTO,
  type TaskPriority,
  type TaskSort,
  type TaskStatus,
  type TaskSummaryDTO,
} from "@/contracts";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import { DomainError } from "@/server/http/errors";
import {
  computeFilterFingerprint,
  decodeCursor,
  encodeCursor,
  invalidCursorError,
} from "@/server/modules/pagination/cursor";
import { requireProjectMember } from "@/server/modules/authorization/project-access";
import { fromDueDateString, isValidDueDate } from "./date-only";
import { TASK_SUMMARY_SELECT, toTaskDTO, toTaskSummaryDTO, fetchTaskResourceCounts, fetchTaskResourceCountsBatch } from "./mappers";
import { taskNotFoundError } from "./access";

/**
 * 任务读取服务（M2 / ORB-008，docs/05 §4/§6）。
 *
 * 只读路径用应用 Prisma 单例（不开事务）；授权统一走 requireProjectMember（非成员/不存在 → 404）。
 * 列表用 keyset 游标分页，支持三种排序：
 *  - updated_desc（默认）：updatedAt DESC, id DESC；
 *  - due_asc：dueDate ASC NULLS LAST, id ASC（截止日空值排尾，docs/05 §6）；
 *  - priority_desc：priority DESC（枚举声明序 → HIGH→MEDIUM→LOW→NONE）, id DESC。
 * 游标携带排序字段值 + 末项 id + 过滤指纹；过滤/排序变化或游标损坏 → 400 INVALID_CURSOR。
 *
 * GET /tasks/{id} 先定位最小 projectId，再验成员关系与 deletedAt（软删除 → 404，docs/05 §4）。
 */

/** 列表默认与上限（docs/05 §6：默认 30，上限 100）。 */
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/** priority_desc 的权重序（HIGH→NONE），用于游标 keyset 的「严格其后」集合计算。 */
const PRIORITY_DESC_ORDER: TaskPriority[] = ["HIGH", "MEDIUM", "LOW", "NONE"];

/** listProjectTasks 结果：当页数据 + 下一页游标 + 是否还有更多。 */
export interface TaskListResult {
  tasks: TaskSummaryDTO[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** assigneeId 与 unassigned=true 互斥（docs/05 §6）—— 400 VALIDATION_ERROR。 */
function assigneeUnassignedConflictError(): DomainError {
  return new DomainError("VALIDATION_ERROR", "请求校验未通过，请检查输入后重试。", {
    assigneeId: ["不能同时指定 assigneeId 与 unassigned=true"],
  });
}

/** 排序 → Prisma orderBy。 */
export function orderByFor(sort: TaskSort): Prisma.TaskOrderByWithRelationInput[] {
  if (sort === "due_asc") {
    return [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }];
  }
  if (sort === "priority_desc") {
    return [{ priority: "desc" }, { id: "desc" }];
  }
  return [{ updatedAt: "desc" }, { id: "desc" }];
}

/** 严格排在 p 之后的优先级集合（priority_desc 序）。非法值返回 null。 */
function prioritiesAfter(p: string): TaskPriority[] | null {
  const idx = PRIORITY_DESC_ORDER.indexOf(p as TaskPriority);
  if (idx < 0) return null;
  return PRIORITY_DESC_ORDER.slice(idx + 1);
}

/** 按排序构造游标 keyset 条件；游标值类型/语义不符 → 400 INVALID_CURSOR。 */
export function keysetCondition(
  sort: TaskSort,
  decoded: { sortValues: unknown[]; id: string },
): Prisma.TaskWhereInput {
  const primary = decoded.sortValues[0];
  const cid = decoded.id;

  // 游标内部值一律视为**不可信输入**：过滤指纹非 HMAC，可被篡改；非法值直接用于比较
  // 会触发 @db.Uuid 列的 PG 22P02（id 非合法 UUID）或 fromDueDateString RangeError → 500。
  // 故先做语义校验，失败 → 400 INVALID_CURSOR。
  if (!UuidSchema.safeParse(cid).success) throw invalidCursorError();

  if (sort === "due_asc") {
    if (primary === null) {
      // 游标处于「无截止日」尾段：只要 null 且 id 更大者。
      return { dueDate: null, id: { gt: cid } };
    }
    if (typeof primary !== "string" || !isValidDueDate(primary)) throw invalidCursorError();
    const cursorDue = fromDueDateString(primary); // 已过 isValidDueDate 校验，不会抛 RangeError
    return {
      OR: [
        { dueDate: { gt: cursorDue } },
        { dueDate: cursorDue, id: { gt: cid } },
        { dueDate: null }, // NULLS LAST：所有无截止日行都排在有截止日之后
      ],
    };
  }

  if (sort === "priority_desc") {
    if (typeof primary !== "string") throw invalidCursorError();
    const after = prioritiesAfter(primary);
    if (after === null) throw invalidCursorError();
    const ors: Prisma.TaskWhereInput[] = [];
    if (after.length > 0) ors.push({ priority: { in: after } });
    ors.push({ priority: primary as TaskPriority, id: { lt: cid } });
    return { OR: ors };
  }

  // updated_desc（默认）
  if (typeof primary !== "string") throw invalidCursorError();
  const cursorUpdatedAt = new Date(primary);
  if (Number.isNaN(cursorUpdatedAt.getTime())) throw invalidCursorError();
  return {
    OR: [
      { updatedAt: { lt: cursorUpdatedAt } },
      { updatedAt: cursorUpdatedAt, id: { lt: cid } },
    ],
  };
}

/** 末项 → 游标排序字段值。 */
export function sortValuesFor(sort: TaskSort, task: TaskSummaryDTO): unknown[] {
  if (sort === "due_asc") return [task.dueDate, task.id];
  if (sort === "priority_desc") return [task.priority, task.id];
  return [task.updatedAt, task.id];
}

/**
 * 转义 ILIKE 通配符（% _ \）。PostgreSQL 的 LIKE/ILIKE 默认转义符即反斜杠，
 * 故对 contains 入参转义后，% 与 _ 仅作字面量匹配，避免 q="%" 匹配全部并退化全表扫描。
 */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * 列出项目任务（keyset 游标分页）。授权：成员可见（非成员/不存在 → 404）。
 * 过滤：q(ILIKE title) / status / priority / assigneeId / unassigned / overdue / deleted。
 */
export async function listProjectTasks(
  projectId: string,
  userId: string,
  query: TaskListQueryDTO,
): Promise<TaskListResult> {
  const { project } = await requireProjectMember(prisma, projectId, userId);

  // assigneeId 与 unassigned=true 互斥（业务规则，服务端校验，docs/05 §6）。
  if (query.assigneeId !== undefined && query.unassigned === true) {
    throw assigneeUnassignedConflictError();
  }

  const sort = query.sort ?? "updated_desc";
  const deleted = query.deleted ?? "exclude";
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const user = query.overdue ? await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }) : null;
  const today = query.overdue ? dateInTimezone(registrationTimezone(user?.timezone)) : null;
  const fingerprint = computeFilterFingerprint({
    today,
    projectId,
    q: query.q ?? null,
    status: query.status ?? null,
    priority: query.priority ?? null,
    assigneeId: query.assigneeId ?? null,
    unassigned: query.unassigned === true,
    overdue: query.overdue === true,
    deleted,
    sort,
  });

  const conditions: Prisma.TaskWhereInput[] = [
    { projectId },
    deleted === "only" ? { deletedAt: { not: null } } : { deletedAt: null },
  ];

  if (query.q !== undefined && query.q.length > 0) {
    // 转义 ILIKE 通配符（PG 默认反斜杠转义），避免 q 中的 %/_ 被当作通配符。
    const text = query.q.toUpperCase().replace(project.key + "-", "");
    const number = /^\d+$/.test(text) ? Number(text) : 0;
    const matches: Prisma.TaskWhereInput[] = [{ title: { contains: escapeLike(query.q), mode: "insensitive" } }];
    if (Number.isSafeInteger(number) && number > 0 && number <= 2147483647) matches.push({ number });
    conditions.push({ OR: matches });
  }
  if (query.status !== undefined) conditions.push({ status: query.status });
  if (query.priority !== undefined) conditions.push({ priority: query.priority });
  if (query.unassigned === true) conditions.push({ assigneeId: null });
  if (query.assigneeId !== undefined) conditions.push({ assigneeId: query.assigneeId });
  if (query.overdue === true) {
    // 用户日历日期决定逾期；再映射为数据库 date 值，不以 UTC 今天代替。
    conditions.push({ dueDate: { lt: fromDueDateString(today!) } });
    conditions.push({ status: { not: "DONE" satisfies TaskStatus } });
  }

  if (query.cursor) {
    const decoded = decodeCursor(query.cursor, fingerprint);
    conditions.push(keysetCondition(sort, decoded));
  }

  // F14：摘要列表使用显式投影，不拉取 description 等大字段。
  const rows = await prisma.task.findMany({
    where: { AND: conditions },
    orderBy: orderByFor(sort),
    take: limit + 1,
    select: TASK_SUMMARY_SELECT,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  
  // M5: 并发聚合真实计数
  const batchCounts=await fetchTaskResourceCountsBatch(prisma,page.map(row=>row.id));
  const tasksWithCounts = await Promise.all(
    page.map(async (row) => {
      const counts = batchCounts.get(row.id)!;
      return await toTaskSummaryDTO(row, { projectKey: project.key }, counts);
    })
  );
  const tasks = tasksWithCounts;

  let nextCursor: string | null = null;
  if (hasMore) {
    const last = tasks[tasks.length - 1];
    const lastRow = page[page.length - 1];
    if (last && lastRow) {
      nextCursor = encodeCursor(sortValuesFor(sort, last), lastRow.id, fingerprint);
    }
  }

  return { tasks, nextCursor, hasMore };
}

/**
 * 页面读取「项目内的指定任务」：不存在、已软删除、属于其他项目或不可见时返回 null。
 * 调用方须已确认项目可访问；看板/列表据此在任务被他人删除后保留页面与草稿，
 * 而不是把整页变成不可访问（项目本身不可见仍由 getProject 统一 404）。
 */
export async function findProjectTask(
  taskId: string,
  projectId: string,
  userId: string,
): Promise<TaskDTO | null> {
  try {
    const task = await getTask(taskId, userId);
    return task.projectId === projectId ? task : null;
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

/** 读取单个未删除任务详情（成员可见）；不存在/非成员/已软删除 → 404 NOT_FOUND。 */
export async function getTask(taskId: string, userId: string): Promise<TaskDTO> {
  if (!UuidSchema.safeParse(taskId).success) throw taskNotFoundError();

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { key: true } },
      assignee: { select: { id: true, name: true } },
      creator: { select: { id: true, name: true } },
    },
  });
  if (!task) throw taskNotFoundError();

  // 先定位最小 projectId，再验成员关系（非成员 → 404），最后判软删除（docs/05 §4）。
  await requireProjectMember(prisma, task.projectId, userId);
  if (task.deletedAt !== null) throw taskNotFoundError();

  // M5: 真实聚合计数
  const counts = await fetchTaskResourceCounts(prisma, task.id);
  return await toTaskDTO(task, { projectKey: task.project.key }, counts);
}
