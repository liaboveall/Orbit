import "server-only";
import type { CommentDTO, CreateCommentDTO, UpdateCommentDTO, ActivityMetadataField } from "@/contracts";
import { CommentSchema, UuidSchema } from "@/contracts";
import type { Prisma } from "@/generated/prisma/client";
import { DomainError } from "@/server/http/errors";
import { prisma } from "@/server/db/prisma";
import { lockProjectRow, withTransaction } from "@/server/db/tx";
import { appendActivity } from "@/server/modules/activity/writer";
import { projectNotFoundError } from "@/server/modules/authorization/project-access";
import {
  beginIdempotency,
  commitIdempotency,
  hashRequest,
  IdempotencyCommitConflictError,
} from "@/server/modules/idempotency/service";
import { MAX_COMMENTS_PER_TASK } from "@/server/modules/limits";
import {
  computeFilterFingerprint,
  decodeCursor,
  encodeCursor,
  invalidCursorError,
} from "@/server/modules/pagination/cursor";
import { formatIdentifier } from "@/server/modules/task/identifier";
import {
  locateTaskProject,
  requireWritableTaskSubresource,
  resolveReadableTaskSubresource,
  touchTaskUpdatedAt,
} from "@/server/modules/task/subresource";
import {
  canDeleteComment,
  commentDeleteForbiddenError,
  commentEditForbiddenError,
  commentLimitExceededError,
  commentNotFoundError,
  commentVersionConflictError,
  countActiveComments,
} from "./access";
import { toCommentDTO } from "./mappers";

/**
 * 评论服务（M5 / ORB-017，docs/01 §8、docs/04 §3/§4、docs/05 §5/§6/§8）。
 *
 * 设计要点：
 *  - **独立 version**：评论自维护乐观并发版本，与父任务 version 完全解耦；
 *  - **纯文本存储**：body 以 text 列存储，不做 Markdown/HTML 渲染，前端 `<pre>` 呈现；
 *  - **删除保留占位**：软删除清空 body 为 ''，保留 authorId/时间戳，GET 映射为
 *    body=null + isDeleted=true（docs/04 §3）；
 *  - **分页**：cursor keyset (createdAt, id) ASC，默认 30 条/页，上限 100；
 *  - **幂等提交**：POST 需 Idempotency-Key（docs/05 §5）；
 *  - **父任务 updatedAt 同步**：写入刷新父任务 updatedAt，不动 task.version。
 */

/** 列表默认与上限（docs/05 §6）。 */
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/** 构造 400 VALIDATION_ERROR。 */
function validationError(fieldErrors: Record<string, string[]>): DomainError {
  return new DomainError("VALIDATION_ERROR", "请求校验未通过，请检查输入后重试。", fieldErrors);
}

/** createComment 的幂等 routeKey。 */
export function createCommentRouteKey(taskId: string): string {
  return `POST /tasks/${taskId.toLowerCase()}/comments`;
}

/** createComment 结果。 */
export interface CreateCommentResult {
  comment: CommentDTO;
  replayed: boolean;
}

/** listComments 结果。 */
export interface CommentListResult {
  comments: CommentDTO[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** 评论查询的 author include。 */
const authorInclude = { author: { select: { id: true, name: true } } } as const;

/**
 * 列出某任务的评论（keyset 游标分页，createdAt,id ASC）。
 * 包含已删除评论（body=null 占位），按时间顺序展示完整讨论流。
 */
export async function listComments(
  taskId: string,
  userId: string,
  query: { cursor?: string; limit?: number },
): Promise<CommentListResult> {
  await resolveReadableTaskSubresource(taskId, userId);

  const normalizedTaskId = taskId.toLowerCase();
  const limit = Math.max(1, Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const fingerprint = computeFilterFingerprint({
    taskId: normalizedTaskId,
    sort: "createdAt_asc",
  });

  const conditions: Prisma.CommentWhereInput[] = [{ taskId: normalizedTaskId }];

  if (query.cursor) {
    const decoded = decodeCursor(query.cursor, fingerprint);
    const primary = decoded.sortValues[0];
    const cid = decoded.id;
    if (!UuidSchema.safeParse(cid).success) throw invalidCursorError();
    if (typeof primary !== "string") throw invalidCursorError();
    const cursorCreatedAt = new Date(primary);
    if (Number.isNaN(cursorCreatedAt.getTime())) throw invalidCursorError();
    conditions.push({
      OR: [
        { createdAt: { gt: cursorCreatedAt } },
        { createdAt: cursorCreatedAt, id: { gt: cid } },
      ],
    });
  }

  const rows = await prisma.comment.findMany({
    where: { AND: conditions },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    include: authorInclude,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const comments = page.map(toCommentDTO);

  let nextCursor: string | null = null;
  if (hasMore) {
    const lastRow = page[page.length - 1];
    if (lastRow) {
      nextCursor = encodeCursor(
        [lastRow.createdAt.toISOString(), lastRow.id],
        lastRow.id,
        fingerprint,
      );
    }
  }

  return { comments, nextCursor, hasMore };
}

/**
 * 创建评论（需 Idempotency-Key，docs/05 §5）。
 */
export async function createComment(
  taskId: string,
  userId: string,
  input: CreateCommentDTO,
  idempotencyKey: string,
): Promise<CreateCommentResult> {
  const projectId = await locateTaskProject(taskId);
  taskId = taskId.toLowerCase();
  const requestHash = hashRequest(input);
  const routeKey = createCommentRouteKey(taskId);
  const idempotencyOpts = {
    userId,
    method: "POST",
    routeKey,
    key: idempotencyKey,
    requestHash,
  } as const;

  const execute = () => withTransaction(async (tx) => {
    const locked = await lockProjectRow(tx, projectId);
    if (!locked) throw projectNotFoundError();

    const { task, access } = await requireWritableTaskSubresource(tx, projectId, taskId, userId);

    const begin = await beginIdempotency(tx, idempotencyOpts);
    if (begin.kind === "replay") {
      return { comment: await readCommentReplay(tx, taskId, begin), replayed: true };
    }

    // 正文 trim 后须 1—2000（纯文本存储，DB CHECK char_length(body)<=2000 兜底）。
    const body = input.body.trim();
    if (body.length < 1 || body.length > 2000) {
      throw validationError({ body: ["评论正文需为 1—2000 个字符"] });
    }

    // 配额：锁内计数未删除评论。
    if ((await countActiveComments(tx, taskId)) >= MAX_COMMENTS_PER_TASK) {
      throw commentLimitExceededError();
    }

    const created = await tx.comment.create({
      data: {
        taskId,
        authorId: userId,
        body,
        version: 1,
      } satisfies Prisma.CommentUncheckedCreateInput,
      include: authorInclude,
    });

    await touchTaskUpdatedAt(tx, taskId);

    await appendActivity(tx, {
      projectId,
      actorId: userId,
      entityType: "COMMENT",
      entityId: created.id,
      action: "COMMENT_CREATED",
      metadata: { taskIdentifier: formatIdentifier(access.project.key, task.number) },
    });

    const comment = toCommentDTO(created);

    await commitIdempotency(tx, {
      ...idempotencyOpts,
      responseStatus: 201,
      responseBody: comment,
      resourceId: created.id,
    });

    return { comment, replayed: false };
  });

  try {
    return await execute();
  } catch (error) {
    if (error instanceof IdempotencyCommitConflictError) {
      return execute();
    }
    throw error;
  }
}

/** 幂等重放读取。 */
async function readCommentReplay(
  tx: Prisma.TransactionClient,
  taskId: string,
  replay: { resourceId: string | null; body: unknown },
): Promise<CommentDTO> {
  if (!replay.resourceId) throw commentNotFoundError();
  const row = await tx.comment.findUnique({
    where: { id: replay.resourceId },
    include: authorInclude,
  });
  if (!row || row.taskId !== taskId) throw commentNotFoundError();
  if (row.deletedAt !== null) return toCommentDTO(row);
  const cached = CommentSchema.parse(replay.body);
  if (cached.id !== row.id || cached.taskId !== taskId) throw commentNotFoundError();
  return cached;
}

/**
 * 更新评论（仅作者本人可编辑，docs/01 §8）。
 */
export async function updateComment(
  commentId: string,
  userId: string,
  input: UpdateCommentDTO,
): Promise<CommentDTO> {
  if (!UuidSchema.safeParse(commentId).success) throw commentNotFoundError();

  const locator = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { taskId: true, task: { select: { projectId: true } } },
  });
  if (!locator) throw commentNotFoundError();
  const { taskId } = locator;
  const projectId = locator.task.projectId;

  return withTransaction(async (tx) => {
    const locked = await lockProjectRow(tx, projectId);
    if (!locked) throw projectNotFoundError();

    const { task, access } = await requireWritableTaskSubresource(tx, projectId, taskId, userId);

    const comment = await tx.comment.findUnique({
      where: { id: commentId },
      include: authorInclude,
    });
    if (!comment || comment.taskId !== taskId) throw commentNotFoundError();

    // 已删除评论不可编辑。
    if (comment.deletedAt !== null) throw commentNotFoundError();

    // 仅作者可编辑（docs/01 §8）。
    if (comment.authorId !== userId) throw commentEditForbiddenError();

    if (comment.version !== input.expectedVersion) {
      throw commentVersionConflictError(comment.version);
    }

    const body = input.body.trim();
    if (body.length < 1 || body.length > 2000) {
      throw validationError({ body: ["评论正文需为 1—2000 个字符"] });
    }

    // 无语义变化：不 bump version、不写活动。
    if (body === comment.body) return toCommentDTO(comment);

    const updated = await tx.comment.update({
      where: { id: commentId },
      data: {
        body,
        version: comment.version + 1,
        editedAt: new Date(),
      },
      include: authorInclude,
    });

    await touchTaskUpdatedAt(tx, taskId);

    const changedFields: ActivityMetadataField[] = ["body"];
    await appendActivity(tx, {
      projectId,
      actorId: userId,
      entityType: "COMMENT",
      entityId: comment.id,
      action: "COMMENT_UPDATED",
      metadata: {
        fields: changedFields,
        taskIdentifier: formatIdentifier(access.project.key, task.number),
      },
    });

    return toCommentDTO(updated);
  });
}

/**
 * 软删除评论（作者或 owner，docs/01 §8）。
 * 删除时清空 body 为 ''，保留 authorId/时间戳占位（docs/04 §3）。
 * 契约返回 200 + CommentDTO（body=null, isDeleted=true）。
 */
export async function deleteComment(
  commentId: string,
  userId: string,
  expectedVersion: number,
): Promise<CommentDTO> {
  if (!UuidSchema.safeParse(commentId).success) throw commentNotFoundError();

  const locator = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { taskId: true, task: { select: { projectId: true } } },
  });
  if (!locator) throw commentNotFoundError();
  const { taskId } = locator;
  const projectId = locator.task.projectId;

  return withTransaction(async (tx) => {
    const locked = await lockProjectRow(tx, projectId);
    if (!locked) throw projectNotFoundError();

    const { task, access } = await requireWritableTaskSubresource(tx, projectId, taskId, userId);

    const comment = await tx.comment.findUnique({
      where: { id: commentId },
      include: authorInclude,
    });
    if (!comment || comment.taskId !== taskId) throw commentNotFoundError();

    // 已删除的评论再次删除 → 404。
    if (comment.deletedAt !== null) throw commentNotFoundError();

    if (comment.version !== expectedVersion) {
      throw commentVersionConflictError(comment.version);
    }

    // 权限：作者本人 OR 项目 owner（docs/01 §8）。
    if (!canDeleteComment(access.role, comment.authorId, userId)) {
      throw commentDeleteForbiddenError();
    }

    // 软删除：清空 body、置 deletedAt、version++（docs/04 §3）。
    const updated = await tx.comment.update({
      where: { id: commentId },
      data: {
        body: "",
        deletedAt: new Date(),
        version: comment.version + 1,
      },
      include: authorInclude,
    });

    // Deletion overrides historical replay: scrub the cached text atomically.
    await tx.idempotencyRecord.updateMany({
      where: { resourceId: comment.id, method: "POST", userId: comment.authorId },
      data: { responseBody: toCommentDTO(updated) },
    });

    await touchTaskUpdatedAt(tx, taskId);

    await appendActivity(tx, {
      projectId,
      actorId: userId,
      entityType: "COMMENT",
      entityId: comment.id,
      action: "COMMENT_DELETED",
      metadata: { taskIdentifier: formatIdentifier(access.project.key, task.number) },
    });

    return toCommentDTO(updated);
  });
}
