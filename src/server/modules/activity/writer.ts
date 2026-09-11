import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { ActivityAction, ActivityEntityType } from "@/contracts";

/**
 * 活动写入器（M2 / ORB-007，docs/04 §3 ActivityLog、docs/05 §9）。
 *
 * 原则：
 *  - **只追加**，不编辑；必须在业务事务内调用，与业务改动同原子性（docs/01 §8：
 *    日志与对应业务写入同一数据库事务）。
 *  - metadata 走**白名单过滤**：只保留 docs/04 允许的字段（任务编号、变更字段名、
 *    枚举状态、用户 ID、计数），绝不存原始描述/评论/文件内容/令牌。
 *  - 一次用户操作只产生清晰的一条主要事件（由调用方决定写哪条），本函数只负责单条 INSERT。
 */

/** metadata 允许保留的字段白名单（docs/04 §3、契约 ActivityMetadataSchema）。 */
const METADATA_WHITELIST = [
  "taskIdentifier",
  "fields",
  "fromStatus",
  "toStatus",
  "targetUserId",
  "count",
] as const;

/** appendActivity 的入参。 */
export interface ActivityEntry {
  projectId: string;
  actorId: string;
  entityType: ActivityEntityType;
  entityId: string;
  action: ActivityAction;
  metadata?: Record<string, unknown>;
}

/** 按白名单过滤 metadata，丢弃任何未列出的键（防止敏感/越权内容入库）。 */
export function filterActivityMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const result: Record<string, unknown> = {};
  for (const key of METADATA_WHITELIST) {
    const value = metadata[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/** 在事务内追加一条活动日志（metadata 经白名单过滤后写入 jsonb）。 */
export async function appendActivity(
  tx: Prisma.TransactionClient,
  entry: ActivityEntry,
): Promise<void> {
  await tx.activityLog.create({
    data: {
      projectId: entry.projectId,
      actorId: entry.actorId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      metadata: filterActivityMetadata(entry.metadata) as Prisma.InputJsonValue,
    },
  });
}
