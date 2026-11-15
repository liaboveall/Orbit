import "server-only";
import {
  TaskSchema,
  TaskSummarySchema,
  type TaskDTO,
  type TaskSummaryDTO,
} from "@/contracts";
import type { Prisma, Task } from "@/generated/prisma/client";
import { formatIdentifier } from "./identifier";
import { toDueDateString } from "./date-only";

/**
 * 任务行 → 契约 DTO 映射（docs/05 §6）。
 *
 * 要点：
 *  - identifier = `${projectKey}-${number}`（docs/01 §6：ORB-12 形式）；
 *  - dueDate 用 UTC date-only 映射（toDueDateString），避免时区偏移错一天；
 *  - **position 绝不入 DTO**：TaskSummarySchema 为 strict，无 position 字段（docs/04 §5）；
 *  - assignee/creator → UserSummary `{id, name}`，**不含 email**（docs/05 §4）；
 *  - 出库前经契约 schema 复校一次，只暴露白名单字段。
 *
 * 读取形状：任务查询只取标量列（含 assigneeId / creatorId）。姓名和子任务/评论/附件计数
 * 由 fetchTaskExtras 用**一条语句**补齐。Prisma 的关联 select 每个关联各发一条查询，
 * 看板三列就是九条；这里无论多少任务都只多一次往返。
 */

/** 子任务/评论/附件的聚合计数。 */
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

/** 摘要查询的显式投影（列表/看板/工作台共用）：不读取 description 等摘要不消费的大字段。 */
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
  assigneeId: true,
  creatorId: true,
} as const satisfies Prisma.TaskSelect;

/** toTaskSummaryDTO 实际消费的列（投影行与完整行均可赋值）。 */
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
  | "assigneeId"
  | "creatorId"
>;

/** 一批任务的展示补充数据：成员姓名、聚合计数，以及按需的项目 key。 */
export interface TaskExtras {
  /** userId → 显示名（未归一化）。 */
  people: Map<string, string>;
  /** taskId → 计数；每个传入的任务都有一项。 */
  counts: Map<string, ResourceCounts>;
  /** projectId → key；仅在 withProjectKeys 时填充（跨项目的工作台）。 */
  projectKeys: Map<string, string>;
}

type ExtrasRow = {
  people: Record<string, string> | null;
  counts: Array<{ id: string; st: number; sc: number; cc: number; ac: number }> | null;
  projectKeys: Record<string, string> | null;
};

/**
 * 一条语句取回一批任务的姓名、计数（以及项目 key）。
 *
 * 计数用按 taskId 的相关子查询，命中 (taskId, …) 索引；附件只计 UPLOADING/READY 且未删除，
 * 与列表口径一致。姓名按 userId 查，而不是按任务行连接：任务行与本语句不在同一快照时，
 * 以调用方手里的 assigneeId / creatorId 为准。
 */
export async function fetchTaskExtras(
  client: Prisma.TransactionClient,
  tasks: ReadonlyArray<Pick<Task, "id" | "projectId" | "assigneeId" | "creatorId">>,
  options: { withProjectKeys?: boolean } = {},
): Promise<TaskExtras> {
  const extras: TaskExtras = { people: new Map(), counts: new Map(), projectKeys: new Map() };
  if (tasks.length === 0) return extras;

  const taskIds = tasks.map((task) => task.id);
  const userIds = [...new Set(tasks.flatMap((task) => (task.assigneeId ? [task.assigneeId, task.creatorId] : [task.creatorId])))];
  const projectIds = options.withProjectKeys ? [...new Set(tasks.map((task) => task.projectId))] : [];

  const rows = await client.$queryRaw<ExtrasRow[]>`
    SELECT
      (SELECT json_object_agg(u.id, u.name) FROM "User" u WHERE u.id = ANY(${userIds}::text[])) AS people,
      (SELECT json_agg(json_build_object(
          'id', t.id,
          'st', (SELECT count(*) FROM "Subtask" s WHERE s."taskId" = t.id AND s."deletedAt" IS NULL),
          'sc', (SELECT count(*) FROM "Subtask" s WHERE s."taskId" = t.id AND s."deletedAt" IS NULL AND s."isCompleted"),
          'cc', (SELECT count(*) FROM "Comment" c WHERE c."taskId" = t.id AND c."deletedAt" IS NULL),
          'ac', (SELECT count(*) FROM "Attachment" a WHERE a."taskId" = t.id AND a."deletedAt" IS NULL
                   AND a.state IN ('UPLOADING', 'READY'))
        ))
        FROM unnest(${taskIds}::uuid[]) AS t(id)) AS counts,
      (SELECT json_object_agg(p.id, p.key) FROM "Project" p WHERE p.id = ANY(${projectIds}::uuid[])) AS "projectKeys"
  `;
  const row = rows[0];
  for (const [id, name] of Object.entries(row?.people ?? {})) extras.people.set(id, name);
  for (const [id, key] of Object.entries(row?.projectKeys ?? {})) extras.projectKeys.set(id, key);
  for (const id of taskIds) extras.counts.set(id, emptyResourceCounts());
  for (const item of row?.counts ?? []) {
    extras.counts.set(item.id, {
      subtaskTotal: Number(item.st),
      subtaskCompleted: Number(item.sc),
      commentCount: Number(item.cc),
      attachmentCount: Number(item.ac),
    });
  }
  return extras;
}

/** toTaskSummaryDTO / toTaskDTO 的选项。 */
export interface TaskMapperOptions {
  /** 所属项目 key，用于拼装 identifier。 */
  projectKey: string;
}

/** 归一化显示名（与 UserSummary 的 min(1)/max(40) 一致，容错历史异常资料）。 */
function displayName(name: string | undefined): string {
  return name?.trim().slice(0, 40) || "未设置姓名";
}

function person(id: string, extras: TaskExtras): { id: string; name: string } {
  return { id, name: displayName(extras.people.get(id)) };
}

/**
 * 组装 TaskSummary 的**未校验**对象。调用方必须让它恰好经过一次契约 schema：
 * 单条用 toTaskSummaryDTO / toTaskDTO，整块响应（看板）用外层 schema 一次校验全部。
 */
export function buildTaskSummary(
  task: TaskSummaryRow,
  opts: TaskMapperOptions,
  extras: TaskExtras,
): Record<string, unknown> {
  const counts = extras.counts.get(task.id) ?? emptyResourceCounts();
  return {
    id: task.id,
    projectId: task.projectId,
    number: task.number,
    identifier: formatIdentifier(opts.projectKey, task.number),
    title: task.title,
    status: task.status,
    priority: task.priority,
    assignee: task.assigneeId ? person(task.assigneeId, extras) : null,
    creator: person(task.creatorId, extras),
    dueDate: task.dueDate ? toDueDateString(task.dueDate) : null,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    version: task.version,
    subtaskTotal: counts.subtaskTotal,
    subtaskCompleted: counts.subtaskCompleted,
    commentCount: counts.commentCount,
    attachmentCount: counts.attachmentCount,
    deletedAt: task.deletedAt ? task.deletedAt.toISOString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

/** 任务行 → 契约 TaskSummaryDTO（不含 description）。 */
export function toTaskSummaryDTO(
  task: TaskSummaryRow,
  opts: TaskMapperOptions,
  extras: TaskExtras,
): TaskSummaryDTO {
  return TaskSummarySchema.parse(buildTaskSummary(task, opts, extras));
}

/** 完整任务行 → 契约 TaskDTO（= TaskSummary + description）。 */
export function toTaskDTO(
  task: TaskSummaryRow & Pick<Task, "description">,
  opts: TaskMapperOptions,
  extras: TaskExtras,
): TaskDTO {
  return TaskSchema.parse({ ...buildTaskSummary(task, opts, extras), description: task.description });
}

/** 单个任务的便捷形式：补齐展示数据并映射为 TaskDTO（写操作的响应）。 */
export async function loadTaskDTO(
  client: Prisma.TransactionClient,
  task: Task,
  opts: TaskMapperOptions,
): Promise<TaskDTO> {
  return toTaskDTO(task, opts, await fetchTaskExtras(client, [task]));
}
