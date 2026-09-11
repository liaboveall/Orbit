import "server-only";
import { CommentSchema, type CommentDTO } from "@/contracts";
import type { Comment } from "@/generated/prisma/client";

/**
 * 评论行 → 契约 DTO 映射（M5 / ORB-017，docs/05 §6）。
 *
 * 要点：
 *  - 删除后的评论：body=null, isDeleted=true（占位保留 authorId/时间，docs/04 §3）；
 *  - author → UserSummary `{id, name}`，不含 email（docs/05 §4）；
 *  - version 独立于父任务 version（docs/05 §5）；
 *  - 出库前经契约 schema 复校，只暴露白名单字段。
 */

/** 评论关联的作者信息（查询时 select {id, name} 注入）。 */
export interface CommentWithAuthor extends Comment {
  author: { id: string; name: string };
}

/** 归一化显示名（与 UserSummary min(1)/max(40) 一致）。 */
function displayName(name: string): string {
  return name.trim().slice(0, 40) || "未设置姓名";
}

/** 数据库 Comment 行（含 author）→ 契约 CommentDTO。 */
export function toCommentDTO(comment: CommentWithAuthor): CommentDTO {
  const isDeleted = comment.deletedAt !== null;
  return CommentSchema.parse({
    id: comment.id,
    taskId: comment.taskId,
    author: { id: comment.author.id, name: displayName(comment.author.name) },
    // 已删除评论 body 映射为 null（DB 中已清空为 ''，不泄露原始内容）。
    body: isDeleted ? null : comment.body,
    isDeleted,
    version: comment.version,
    editedAt: comment.editedAt ? comment.editedAt.toISOString() : null,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  });
}
