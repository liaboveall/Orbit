import "server-only";
import { DomainError } from "@/server/http/errors";
import { MAX_SUBTASKS_PER_TASK } from "@/server/modules/limits";
import type { Prisma } from "@/generated/prisma/client";

/**
 * 子任务域错误与配额辅助（M5 / ORB-016，docs/01 §4/§8）。
 *
 * 权限矩阵（docs/01 §8）：新建/编辑/删除子任务，owner 与 member **均可**，
 * 且不区分创建者——子任务是任务的清单而非个人财产，故本域无「仅作者」限制。
 * 宿主任务的可见性/可写性判定统一由 task/subresource.ts 完成，本文件不重复实现。
 */

/** 子任务不可见（不存在、非法 UUID、不属于该任务或已软删除）—— 统一 404，不泄露存在性。 */
export function subtaskNotFoundError(): DomainError {
  return new DomainError("NOT_FOUND", "子任务不存在或你无权访问。");
}

/** 每任务未删除子任务数超上限 —— 422 LIMIT_EXCEEDED。 */
export function subtaskLimitExceededError(): DomainError {
  return new DomainError(
    "LIMIT_EXCEEDED",
    `每个任务最多 ${MAX_SUBTASKS_PER_TASK} 条子任务，请先删除部分子任务。`,
  );
}

/** 子任务乐观并发冲突 —— 409 VERSION_CONFLICT（回传该子任务自己的 currentVersion）。 */
export function subtaskVersionConflictError(currentVersion: number): DomainError {
  return new DomainError(
    "VERSION_CONFLICT",
    "该子任务已被更新，你的输入已保留，请刷新后重试。",
    undefined,
    { currentVersion },
  );
}

/**
 * 统计某任务未删除子任务数（配额判定用）。
 * 必须在持有 Project 行锁的事务内调用，才能与插入形成原子判定（docs/04 §6：
 * 上限在锁内计数校验，不能只靠前端隐藏按钮）。
 */
export async function countActiveSubtasks(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<number> {
  return tx.subtask.count({ where: { taskId, deletedAt: null } });
}
