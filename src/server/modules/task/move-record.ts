import "server-only";

import type { Prisma } from "@/generated/prisma/client";

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
