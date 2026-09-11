import "server-only";
import {
  TaskSchema,
  TaskSummarySchema,
  type TaskDTO,
  type TaskSummaryDTO,
} from "@/contracts";
import type { Task } from "@/generated/prisma/client";
import { formatIdentifier } from "./identifier";
import { toDueDateString } from "./date-only";

/**
 * 任务行 → 契约 DTO 映射（M2 / ORB-008，docs/05 §6）。
 *
 * 要点：
 *  - identifier = `${projectKey}-${number}`（docs/01 §6：ORB-12 形式）；
 *  - dueDate 用 UTC date-only 映射（toDueDateString），避免时区偏移错一天；
 *  - **position 绝不入 DTO**：TaskSummarySchema 为 strict，无 position 字段（docs/04 §5）；
 *  - assignee/creator → UserSummary `{id, name}`，**不含 email**（docs/05 §4）；
 *  - subtaskTotal/subtaskCompleted/commentCount/attachmentCount 在 M5（子任务/评论/附件）
 *    落地前**诚实返回常量 0**，不臆造计数；届时改为真实聚合，签名保持不变；
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
export function toTaskSummaryDTO(
  task: TaskWithPeople,
  opts: TaskMapperOptions,
): TaskSummaryDTO {
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
    // M5（子任务/评论/附件）落地前的诚实零值，非「已实现真实计数」。
    subtaskTotal: 0,
    subtaskCompleted: 0,
    commentCount: 0,
    attachmentCount: 0,
    deletedAt: task.deletedAt ? task.deletedAt.toISOString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  });
}

/** 数据库 Task 行（含 assignee/creator）→ 契约 TaskDTO（= TaskSummary + description）。 */
export function toTaskDTO(task: TaskWithPeople, opts: TaskMapperOptions): TaskDTO {
  return TaskSchema.parse({
    ...toTaskSummaryDTO(task, opts),
    description: task.description,
  });
}
