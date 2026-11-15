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
 *  - 一次用户操作只产生清晰的一条主要事件（由调用方决定写哪条）。
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

/** appendActivity 随活动一并完成的项目/任务行更新（同一条语句，不增加往返）。 */
export interface ActivitySideEffects {
  /** 看板顺序集合变化（创建、移动、删除、恢复、改状态）：同时把 Project.boardVersion 加一。 */
  bumpBoardVersion?: boolean;
  /** 子任务/评论/附件写入：刷新父任务 updatedAt，但不动 task.version（docs/04 §4）。 */
  touchTaskId?: string;
}

/**
 * 在事务内追加一条活动日志（metadata 经白名单过滤后写入 jsonb）。
 *
 * 同一条语句还把 Project.revision 加一：它是 GET /my/pulse 的变更计数。所有业务写入都在
 * 项目锁内调用本函数，所以 revision 按提交顺序严格递增——活动的时间戳做不到这一点
 * （排队等锁的事务可能后提交、时间却更早）。revision 不进入任何 DTO，也不改 updatedAt。
 *
 * createdAt 取语句执行时刻（clock_timestamp），与持锁顺序一致；项目行不存在时不插入并抛错
 * （调用方已持有该行的锁，正常路径不会发生）。
 */
export async function appendActivity(
  tx: Prisma.TransactionClient,
  entry: ActivityEntry,
  effects: ActivitySideEffects = {},
): Promise<void> {
  const metadata = JSON.stringify(filterActivityMetadata(entry.metadata));
  const boardStep = effects.bumpBoardVersion ? 1 : 0;
  // 不需要刷新父任务时 touchTaskId 为 NULL，touched 一行也不匹配；两种情况共用一条语句，
  // revision、boardVersion 与插入的列只写一遍。
  const inserted = await tx.$executeRaw`
    WITH bumped AS (
      UPDATE "Project"
      SET "revision" = "revision" + 1, "boardVersion" = "boardVersion" + ${boardStep}::int
      WHERE id = ${entry.projectId}::uuid
      RETURNING id
    ), touched AS (
      UPDATE "Task" SET "updatedAt" = clock_timestamp()
      WHERE id = ${effects.touchTaskId ?? null}::uuid AND "projectId" = ${entry.projectId}::uuid
    )
    INSERT INTO "ActivityLog" ("projectId", "actorId", "entityType", "entityId", action, metadata, "createdAt")
    SELECT bumped.id, ${entry.actorId}, ${entry.entityType}::"ActivityEntityType", ${entry.entityId},
      ${entry.action}::"ActivityAction", ${metadata}::jsonb, clock_timestamp()
    FROM bumped
  `;
  if (inserted !== 1) throw new Error("appendActivity: project row is missing");
}
