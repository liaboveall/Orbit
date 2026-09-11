import "server-only";
import { DomainError } from "@/server/http/errors";
import { MAX_COMMENTS_PER_TASK } from "@/server/modules/limits";
import type { Prisma } from "@/generated/prisma/client";

/**
 * 评论域错误与权限辅助（M5 / ORB-017，docs/01 §8）。
 *
 * 权限矩阵（docs/01 §8）：
 *  - 发布评论：owner + member 均可；
 *  - 编辑评论：**仅作者本人**（403 FORBIDDEN）；
 *  - 删除评论：owner 可删任意 / member 仅删自己的（403 FORBIDDEN）。
 */

/** 评论不可见（不存在、非法 UUID、不属于该任务）—— 统一 404，不泄露存在性。 */
export function commentNotFoundError(): DomainError {
  return new DomainError("NOT_FOUND", "评论不存在或你无权访问。");
}

/** 每任务未删除评论数超上限 —— 422 LIMIT_EXCEEDED。 */
export function commentLimitExceededError(): DomainError {
  return new DomainError(
    "LIMIT_EXCEEDED",
    `每个任务最多 ${MAX_COMMENTS_PER_TASK} 条评论，请先删除部分评论。`,
  );
}

/** 评论乐观并发冲突 —— 409 VERSION_CONFLICT（回传 currentVersion）。 */
export function commentVersionConflictError(currentVersion: number): DomainError {
  return new DomainError(
    "VERSION_CONFLICT",
    "该评论已被更新，你的输入已保留，请刷新后重试。",
    undefined,
    { currentVersion },
  );
}

/** 非作者编辑评论 —— 403 FORBIDDEN。 */
export function commentEditForbiddenError(): DomainError {
  return new DomainError("FORBIDDEN", "只有评论作者可以编辑。");
}

/** 非作者且非 owner 删除评论 —— 403 FORBIDDEN。 */
export function commentDeleteForbiddenError(): DomainError {
  return new DomainError("FORBIDDEN", "只有评论作者或项目所有者可以删除评论。");
}

/**
 * 统计某任务未删除评论数（配额判定用）。
 * 必须在持有 Project 行锁的事务内调用（docs/04 §6）。
 */
export async function countActiveComments(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<number> {
  return tx.comment.count({ where: { taskId, deletedAt: null } });
}

/**
 * 判定是否可删除评论：作者本人 OR 项目 owner（docs/01 §8）。
 */
export function canDeleteComment(
  role: "OWNER" | "MEMBER",
  authorId: string,
  userId: string,
): boolean {
  return role === "OWNER" || authorId === userId;
}
