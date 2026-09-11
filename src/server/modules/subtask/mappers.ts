import "server-only";
import { SubtaskSchema, type SubtaskDTO } from "@/contracts";
import type { Subtask } from "@/generated/prisma/client";

/**
 * 子任务行 → 契约 DTO 映射（M5 / ORB-016，docs/05 §6）。
 *
 * 要点：
 *  - deletedAt **不入 DTO**（SubtaskSchema 为 strict，无该字段）：子任务软删除对客户端
 *    表现为「消失」，列表本就只查未删除行，故不暴露删除态；
 *  - version 独立于父任务 version（docs/05 §5），原样透出供 expectedVersion 使用；
 *  - 出库前一律经契约 schema 复校，只暴露白名单字段。
 */
export function toSubtaskDTO(subtask: Subtask): SubtaskDTO {
  return SubtaskSchema.parse({
    id: subtask.id,
    taskId: subtask.taskId,
    title: subtask.title,
    isCompleted: subtask.isCompleted,
    version: subtask.version,
    createdAt: subtask.createdAt.toISOString(),
    updatedAt: subtask.updatedAt.toISOString(),
  });
}
