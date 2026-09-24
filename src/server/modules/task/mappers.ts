import "server-only";
import {
  TaskSchema,
  TaskSummarySchema,
  type TaskDTO,
  type TaskSummaryDTO,
} from "@/contracts";
import type { Task } from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";
import { formatIdentifier } from "./identifier";
import { toDueDateString } from "./date-only";

/**
 * 从数据库行聚合真实计数（M5 / ORB-017～018）。
 */
export interface ResourceCounts {
  subtaskTotal: number;
  subtaskCompleted: number;
  commentCount: number;
  attachmentCount: number;
}
export const emptyResourceCounts = (): ResourceCounts => ({
  subtaskTotal: 0,
  subtaskCompleted: 0,
  commentCount: 0,
  attachmentCount: 0,
});
export async function fetchTaskResourceCountsBatch(
  tx: Prisma.TransactionClient,
  ids: string[],
): Promise<Map<string, ResourceCounts>> {
  const result = new Map(ids.map((id) => [id, emptyResourceCounts()]));
  if (!ids.length) return result;
  const [subtasks, comments, attachments] = await Promise.all([
    tx.subtask.groupBy({
      by: ["taskId", "isCompleted"],
      where: { taskId: { in: ids }, deletedAt: null },
      _count: { _all: true },
    }),
    tx.comment.groupBy({
      by: ["taskId"],
      where: { taskId: { in: ids }, deletedAt: null },
      _count: { _all: true },
    }),
    tx.attachment.groupBy({
      by: ["taskId"],
      where: {
        taskId: { in: ids },
        deletedAt: null,
        state: { in: ["UPLOADING", "READY"] },
      },
      _count: { _all: true },
    }),
  ]);
  for (const row of subtasks) {
    const c = result.get(row.taskId)!;
    c.subtaskTotal += row._count._all;
    if (row.isCompleted) c.subtaskCompleted += row._count._all;
  }
  for (const row of comments)
    result.get(row.taskId)!.commentCount = row._count._all;
  for (const row of attachments)
    result.get(row.taskId)!.attachmentCount = row._count._all;
  return result;
}
export async function fetchTaskResourceCounts(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<ResourceCounts> {
  return (await fetchTaskResourceCountsBatch(tx, [taskId])).get(taskId)!;
}

/** 数据库 Task 行（含 assignee/creator）→ 契约 DTO 映射（M2 / ORB-008，docs/05 §6）。
 *
 * 要点：
 *  - identifier = `${projectKey}-${number}`（docs/01 §6：ORB-12 形式）；
 *  - dueDate 用 UTC date-only 映射（toDueDateString），避免时区偏移错一天；
 *  - **position 绝不入 DTO**：TaskSummarySchema 为 strict，无 position 字段（docs/04 §5）；
 *  - assignee/creator → UserSummary `{id, name}`，**不含 email**（docs/05 §4）；
 *  - subtaskTotal/subtaskCompleted/commentCount/attachmentCount：M5 落地前使用真实聚合查询；
 *  - 出库前一律经契约 schema 复校，只暴露白名单字段。
 */

/** UserSummary 精简人（仅 id/name，永不带 email）。 */
export interface TaskPerson {
  id: string;
  name: string;
}

/** 带 assignee/creator 关系的任务行（各服务查询时 select {id,name} 注入）。 */
export interface TaskWithPeople extends Task {
  assignee: TaskPerson | null;
  creator: TaskPerson;
}

/**
 * F14：摘要查询的显式投影（任务列表/看板/工作台共用）——不读取 description 等
 * 摘要不消费的大字段；详情查询仍取完整行。口径与 toTaskSummaryDTO 消费的字段
 * 一一对应（看板另需 position 参与游标）。
 */
export const TASK_SUMMARY_SELECT = {
  id: true,
  projectId: true,
  number: true,
  title: true,
  status: true,
  priority: true,
  dueDate: true,
  completedAt: true,
  version: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  assignee: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
} as const;

/** 看板摘要：额外携带 position（列内游标）。 */
export const TASK_SUMMARY_SELECT_FOR_BOARD = {
  ...TASK_SUMMARY_SELECT,
  position: true,
} as const;

/** 摘要查询行的输入形状：toTaskSummaryDTO 实际消费的字段（投影行/完整行均可赋值）。 */
export type TaskSummaryRow = Pick<
  Task,
  | "id"
  | "projectId"
  | "number"
  | "title"
  | "status"
  | "priority"
  | "dueDate"
  | "completedAt"
  | "version"
  | "deletedAt"
  | "createdAt"
  | "updatedAt"
> & {
  assignee: TaskPerson | null;
  creator: TaskPerson;
};

/** toTaskSummaryDTO / toTaskDTO 的选项。 */
export interface TaskMapperOptions {
  /** 所属项目 key，用于拼装 identifier。 */
  projectKey: string;
}

/** 归一化显示名（与 UserSummary 的 min(1)/max(40) 一致，容错历史异常资料）。 */
function displayName(name: string): string {
  return name.trim().slice(0, 40) || "未设置姓名";
}

/** 精简人 → UserSummary（name 归一化）。 */
function toUserSummary(person: TaskPerson): { id: string; name: string } {
  return { id: person.id, name: displayName(person.name) };
}

/** 数据库 Task 行（含 assignee/creator）→ 契约 TaskSummaryDTO（不含 description）。 */
export async function toTaskSummaryDTO(
  task: TaskSummaryRow,
  opts: TaskMapperOptions,
  counts: {
    subtaskTotal: number;
    subtaskCompleted: number;
    commentCount: number;
    attachmentCount: number;
  },
): Promise<TaskSummaryDTO> {
  return TaskSummarySchema.parse({
    id: task.id,
    projectId: task.projectId,
    number: task.number,
    identifier: formatIdentifier(opts.projectKey, task.number),
    title: task.title,
    status: task.status,
    priority: task.priority,
    assignee: task.assignee ? toUserSummary(task.assignee) : null,
    creator: toUserSummary(task.creator),
    dueDate: task.dueDate ? toDueDateString(task.dueDate) : null,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    version: task.version,
    // M5：真实聚合计数（不再硬编码 0）。
    subtaskTotal: counts.subtaskTotal,
    subtaskCompleted: counts.subtaskCompleted,
    commentCount: counts.commentCount,
    attachmentCount: counts.attachmentCount,
    deletedAt: task.deletedAt ? task.deletedAt.toISOString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  });
}

/** 数据库 Task 行（含 assignee/creator）→ 契约 TaskDTO（= TaskSummary + description）。 */
export async function toTaskDTO(
  task: TaskWithPeople,
  opts: TaskMapperOptions,
  counts: {
    subtaskTotal: number;
    subtaskCompleted: number;
    commentCount: number;
    attachmentCount: number;
  },
): Promise<TaskDTO> {
  return TaskSchema.parse({
    ...(await toTaskSummaryDTO(task, opts, counts)),
    description: task.description,
  });
}
