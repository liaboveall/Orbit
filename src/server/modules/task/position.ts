import "server-only";
import type { Prisma, TaskStatus } from "@/generated/prisma/client";
import { POSITION_GAP } from "@/server/modules/limits";

/**
 * 看板 position 辅助（M2 / ORB-008，docs/04 §5）。
 *
 * 创建、恢复与状态变更复用末尾追加；中点移动与末尾溢出共用列重编号。
 * 重编号只改 position，保持其他任务的 version 与 updatedAt。
 *
 * position 是 bigint，仅在服务端流转，永不进入 DTO（TaskSummarySchema 无 position 字段）。
 * 查询走索引 (projectId, deletedAt, status, position, id)，只读该列未删除任务的末项。
 */

/**
 * node-pg / Prisma driver adapter 对 int8 列的返回类型不稳定（可能是 bigint / string / number），
 * 故宽类型接收后统一用 BigInt() 归一，避免类型断言掩盖真实运行时形态。
 */
type RawPositionRow = { position: bigint | string | number | null };

/**
 * 检测 BigInt 溢出风险：当 lastPosition > MAX_SAFE - POSITION_GAP 时触发全列重编号。
 * 
 * 在 appendHead/column 插入前检查：如果 lastPosition + 1024 > MAX_SAFE_BIGINT，
 * 先在同一事务内执行全列重编号，然后返回新位置。
 * 
 * @param tx 事务客户端
 * @param projectId 项目 UUID
 * @param status 目标列状态
 * @param lastPosition 当前最大 position（null 表示空列）
 * @returns 安全的新 position，如需要重编号则先执行 renumberColumn
 */
async function ensureSafePosition(
  tx: Prisma.TransactionClient,
  projectId: string,
  status: TaskStatus,
  lastPosition: bigint | null,
): Promise<bigint> {
  // 检查是否接近 MAX_SAFE_BIGINT
  const exceeds = lastPosition !== null && lastPosition + POSITION_GAP > BIGINT_MAX_SAFE;
  
  if (!exceeds) {
    return lastPosition === null ? POSITION_GAP : lastPosition + POSITION_GAP;
  }
  
  // 触发全列重编号（不传入 excludeTaskId → null → 重编号全部任务）
  await renumberColumn(tx, projectId, status);
  
  // 重编号后重新查询末项位置
  const freshRows = await tx.$queryRaw<RawPositionRow[]>`
    SELECT position FROM "Task"
    WHERE "projectId" = ${projectId}::uuid
      AND "deletedAt" IS NULL
      AND status = ${status}::"TaskStatus"
    ORDER BY position DESC
    LIMIT 1
  `;
  
  const freshLast = freshRows[0]?.position;
  return freshLast === undefined || freshLast === null 
    ? POSITION_GAP 
    : BigInt(freshLast) + POSITION_GAP;
}

/**
 * 对指定列所有未删除任务进行全列重编号（用于 BigInt overflow 情况）。
 * 
 * 跳过 movingTaskId 参数：全列重编号不涉及移动任务，所以为 null。
 * 保持其他任务的 version/timestamps 不变（使用 raw UPDATE）。
 */
export async function renumberColumn(
  tx: Prisma.TransactionClient,
  projectId: string,
  status: TaskStatus,
  excludeTaskId: string | null = null,
): Promise<void> {
  const rows = await tx.$queryRaw<RawColRow[]>`
    SELECT id, position FROM "Task"
    WHERE "projectId" = ${projectId}::uuid
      AND "deletedAt" IS NULL
      AND status = ${status}::"TaskStatus"
      AND (${excludeTaskId}::uuid IS NULL OR id <> ${excludeTaskId}::uuid)
    ORDER BY position ASC, id ASC
  `;

  // 批量重编号从 GAP 开始
  for (const [idx, row] of rows.entries()) {
    const pos = BigInt(idx + 1) * POSITION_GAP;
    await tx.$executeRaw`
      UPDATE "Task" SET position = ${pos} WHERE id = ${row.id}::uuid
    `;
  }
}

// Raw database result shared by append and move paths.
export interface RawColRow {
  id: string;
  position: bigint | string | number;
}

const BIGINT_MAX_SAFE = 9223372036854775800n;

/**
 * 计算「追加到指定列末尾」的 position。
 *
 * 空列（该 status 下无未删除任务）→ POSITION_GAP（1024）；否则 → 当前最大 position + POSITION_GAP。
 * 检测到接近 MAX_SAFE_BIGINT 时，先在全列重编号再追加。
 * 必须在持有 Project 行锁的事务内调用，读到的末项在提交前不会被并发写改动（docs/04 §4/§5）。
 *
 * @param tx 事务客户端（withTransaction 提供）。
 * @param projectId 项目 UUID。
 * @param status 目标列（TaskStatus 枚举值）。
 */
export async function appendToColumnEnd(
  tx: Prisma.TransactionClient,
  projectId: string,
  status: TaskStatus,
): Promise<bigint> {
  const rows = await tx.$queryRaw<RawPositionRow[]>`
    SELECT position FROM "Task"
    WHERE "projectId" = ${projectId}::uuid
      AND "deletedAt" IS NULL
      AND status = ${status}::"TaskStatus"
    ORDER BY position DESC
    LIMIT 1
  `;
  const last = rows[0]?.position;
  const lastBigInt = last === undefined || last === null ? null : BigInt(last);
  return ensureSafePosition(tx, projectId, status, lastBigInt);
}
