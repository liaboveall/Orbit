import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";

/**
 * 任务移动记录 schema（M3 Phase 1）。
 */
export interface MoveRecordCreateInput {
  taskId: string;
  fromStatus: string;
  toStatus: string;
  fromPosition: bigint;
  toPosition: bigint;
  boardVersion: number;
}

/**
 * 创建移动记录（M3 Phase 1 / ORB-011）。
 *
 * 用于审计跟踪：每次任务移动都记录元数据。
 * 与业务写同事务保证一致性。
 *
 * @param tx - Prisma 事务客户端
 * @param input - 移动记录输入
 */
export async function createMoveRecord(
  tx: Prisma.TransactionClient,
  input: MoveRecordCreateInput,
): Promise<void> {
  await tx.moveRecord.create({
    data: {
      ...input,
      // M3 Phase 1: 后续扩展为完整表时添加 userId、createdAt 等字段
    },
  });
}

/**
 * 查询任务的移动历史（M3 Phase 1）。
 *
 * @param taskId - 任务 ID
 * @returns 移动记录列表（从新到旧）
 */
export async function getTaskMoveHistory(taskId: string): Promise<
  Array<{
    id: string;
    fromStatus: string;
    toStatus: string;
    fromPosition: bigint;
    toPosition: bigint;
    boardVersion: number;
    createdAt: Date;
  }>
> {
  return prisma.moveRecord.findMany({
    where: { taskId },
    orderBy: { createdAt: "desc" },
  });
}
