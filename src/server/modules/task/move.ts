import "server-only";
import type { Prisma, TaskStatus } from "@/generated/prisma/client";
import type { MoveTaskDTO, MoveResultDTO } from "@/contracts";
import { MoveResultSchema, UuidSchema } from "@/contracts";
import { withTransaction, lockProjectRow } from "@/server/db/tx";
import { DomainError } from "@/server/http/errors";
import { requireWritableTaskProject, taskNotFoundError } from "./access";
import { toTaskDTO, fetchTaskResourceCounts } from "./mappers";
import { appendToColumnEnd } from "./position";
// SafePosition type is used internally for position validation
type _SafePosition = bigint;
import { formatIdentifier } from "./identifier";
import { appendActivity } from "@/server/modules/activity/writer";
import { createMoveRecord } from "./move-record";
import { POSITION_GAP } from "@/server/modules/limits";

/** 构造 400 VALIDATION_ERROR（字段级提示）。 */
function validationError(fieldErrors: Record<string, string[]>): DomainError {
  return new DomainError("INVALID_BOARD_TARGET", "目标位置不可用，请刷新看板后重试。", fieldErrors);
}

/** 任务版本冲突 —— 409 VERSION_CONFLICT（回传 currentVersion）。 */
function versionConflictError(currentVersion: number): DomainError {
  return new DomainError("VERSION_CONFLICT", "任务已被更新，请刷新后重试。", undefined, {
    currentVersion,
  });
}

/** 看板版本冲突 —— 409 BOARD_CONFLICT（回传 currentBoardVersion）。 */
function boardConflictError(currentBoardVersion: number): DomainError {
  return new DomainError("BOARD_CONFLICT", "看板已被更新，请刷新后重试。", undefined, {
    currentBoardVersion,
  });
}

/** RawColRow：从 raw query 获取的列中行（id + position）。 */
type RawColRow = { id: string; position: bigint | string | number };

/** Q10: 规范化 UUID 为小写以确保一致性 */
function normalizeUuid(uuid: string): string {
  return uuid.toLowerCase();
}

/** BigInt 安全边界：当 lastPosition > MAX_SAFE - POSITION_GAP*2 时触发重编号 */
const BIGINT_MAX_SAFE = 9223372036854775800n; // Number.MAX_SAFE_INTEGER for bigint

/**
 * 计算 completedAt 变更策略。
 * - 进入 DONE 且无 completedAt → { completedAt }
 * - 离开 DONE 且有 completedAt → { completedAt: null }
 * - 否则 {}（不刷新）
 */
function computeCompletedAt(
  fromStatus: string,
  toStatus: string,
  completedAt: Date | null,
): Partial<{ completedAt: Date | null }> {
  if (toStatus === "DONE" && !completedAt) {
    return { completedAt: new Date() };
  }
  if (fromStatus === "DONE" && completedAt && toStatus !== "DONE") {
    return { completedAt: null };
  }
  return {};
}

/**
 * 将目标列所有任务重新编号（跳过 movingTaskId），用于间隙耗尽时。
 * 返回 beforeTaskId 所在槽位的“新”位置与前一槽位的位置，供插入中点计算。
 * 使用 raw UPDATE 避免触发 Prisma 的 @updatedAt（spec：不递增其他任务 version，docs/04 §5）。
 */
async function renumberColumn(
  tx: Prisma.TransactionClient,
  projectId: string,
  toStatus: string,
  excludeTaskId: string,
  insertIndex: number, // beforeTaskId 在新列中的索引（插入前该位置的任务数）
): Promise<{ newBeforePos: bigint; newPrevPos: bigint }> {
  // 查询目标列非删除任务（排除 movingTaskId），按 position ASC、id ASC
  const rows = await tx.$queryRaw<RawColRow[]>`
    SELECT id, position FROM "Task"
    WHERE "projectId" = ${projectId}::uuid
      AND "deletedAt" IS NULL
      AND status = ${toStatus}::"TaskStatus"
      AND id != ${excludeTaskId}::uuid
    ORDER BY position ASC, id ASC
  `;

  // 为新列分派 positions：1*GAP, 2*GAP, ...
  // beforeTaskId 原在 insertIndex，重编号后其位置为 (insertIndex+1)*GAP，前驱为 insertIndex*GAP
  // 批量 UPDATE（串行 await，确保事务内一致性；只改 position，不动 version/updatedAt）
  for (const [idx, row] of rows.entries()) {
    const pos = BigInt(idx + 1) * POSITION_GAP;
    await tx.$executeRaw`
      UPDATE "Task" SET position = ${pos} WHERE id = ${row.id}::uuid
    `;
  }

  const newPrevPos = BigInt(insertIndex) * POSITION_GAP;
  const newBeforePos = BigInt(insertIndex + 1) * POSITION_GAP;

  return { newBeforePos, newPrevPos };
}

/**
 * 计算移动后的 position。
 * - beforeTaskId === null → appendToColumnEnd(tx, projectId, toStatus)
 * - beforeTaskId !== null → 定位目标列任务列表，find beforeTaskId，取 predecessor & beforeTaskId 的中点；
 *   间隙耗尽则重编号整列再计算。
 */
/** E2 验收导出：中点插入/重编号的生产入口（服务内部此前仅同文件使用）。 */
export async function computeMovePosition(
  tx: Prisma.TransactionClient,
  projectId: string,
  toStatus: string,
  beforeTaskId: string | null,
  movingTaskId: string,
): Promise<bigint> {
  if (beforeTaskId === null) {
    return appendToColumnEnd(tx, projectId, toStatus as TaskStatus);
  }

  // Q10: 规范化 beforeTaskId 和 movingTaskId 为小写以避免大小写不匹配
  const normalizedBeforeTaskId = beforeTaskId ? normalizeUuid(beforeTaskId) : null;
  const normalizedMovingTaskId = normalizeUuid(movingTaskId);

  if (normalizedBeforeTaskId === normalizedMovingTaskId) {
    throw validationError({ beforeTaskId: ["不能将任务移动到其自身之前"] });
  }

  // 查询目标列任务（不含 movingTaskId），按 position ASC、id ASC
  const rows = await tx.$queryRaw<RawColRow[]>`
    SELECT id, position FROM "Task"
    WHERE "projectId" = ${projectId}::uuid
      AND "deletedAt" IS NULL
      AND status = ${toStatus}::"TaskStatus"
      AND id != ${normalizedMovingTaskId}::uuid
    ORDER BY position ASC, id ASC
  `;

  const idx = rows.findIndex((r) => r.id === normalizedBeforeTaskId);
  if (idx === -1) {
    throw validationError({ beforeTaskId: ["目标任务不在指定列中或不存在"] });
  }

  const beforePos = BigInt(rows[idx]!.position);
  const prevPos = idx > 0 ? BigInt(rows[idx - 1]!.position) : null;

  // 间隙耗尽判定：无法在 (prevPos, beforePos) 之间插入一个新整数位置。
  const gapExhausted = prevPos === null ? beforePos < 2n : beforePos - prevPos < 2n;
  if (gapExhausted) {
    const { newPrevPos, newBeforePos } = await renumberColumn(
      tx,
      projectId,
      toStatus,
      movingTaskId,
      idx,
    );
    return (newPrevPos + newBeforePos) / 2n;
  }

  // 正常中点插入
  const midPos = prevPos === null ? beforePos / 2n : (prevPos + beforePos) / 2n;
  
  // 检查中点是否接近 MAX_SAFE（理论上不可能，但防御性编程）
  if (midPos > BIGINT_MAX_SAFE - POSITION_GAP * 2n) {
    const { newPrevPos, newBeforePos } = await renumberColumn(
      tx,
      projectId,
      toStatus,
      movingTaskId,
      idx,
    );
    return (newPrevPos + newBeforePos) / 2n;
  }
  
  return midPos;
}

/**
 * 移动任务（M3 Phase 3 / ORB-011）—— 重写以修复 R2-R5。
 *
 * 实现要点：
 *  - 契约真源：MoveTaskDTO（expectedVersion + expectedBoardVersion + toStatus + beforeTaskId）
 *  - 响应形状：{task: TaskDTO, boardVersion}（绝不含 position）
 *  - 锁顺序：User→Project→Task（本函数只接触 Project+Task，User 由路由调用会话保证）
 *  - 乐观并发：检查任务 version（→ 409 VERSION_CONFLICT）、项目 boardVersion（→ 409 BOARD_CONFLICT）
 *  - 归档规避：requireWritableTaskProject 复核 archivedAt（→ 409 PROJECT_ARCHIVED）
 *  - ActivityLog：TASK_MOVED（withStatus/fromStatus/taskIdentifier）
 *  - 幂等保障：withTransaction + lockProjectRow（死锁/序列化重试兜底）
 *
 * 约束：position bigint 绝不入 DTO；响应经 MoveResultSchema.parse 复校；
 */
export async function moveTask(
  taskId: string,
  userId: string,
  input: MoveTaskDTO,
): Promise<MoveResultDTO> {
  // Q10: 先规范化为大写校验，再转小写存储
  if (!UuidSchema.safeParse(taskId).success) throw taskNotFoundError();
  const normalizedTaskId = normalizeUuid(taskId);

  return withTransaction(async (tx) => {
    // 1. 定位任务（锁前只读）获取最小 projectId（docs/05 §4）
    const locator = await tx.task.findUnique({ where: { id: normalizedTaskId }, select: { projectId: true } });
    if (!locator) throw taskNotFoundError();
    const projectId = locator.projectId;

    // 2. 锁 Project 行（锁顺序 Project→Task），拿到权威 boardVersion/archivedAt/ownerId
    const locked = await lockProjectRow(tx, projectId);
    if (!locked) throw new DomainError("NOT_FOUND", "项目不存在。");

    // 3. 权限 + 归档检查（lock 内权威复核）
    //    - non-member → NOT_FOUND（不区分是否项目存在）
    //    - archived → PROJECT_ARCHIVED
    const { project } = await requireWritableTaskProject(tx, projectId, userId);

    // 4. 重读任务（lock 内，fresh snapshot）
    const freshTask = await tx.task.findUnique({
      where: { id: taskId },
      include: { assignee: { select: { id: true, name: true } }, creator: { select: { id: true, name: true } } },
    });
    if (!freshTask || freshTask.deletedAt !== null) throw taskNotFoundError();

    // 5. 任务版本检查（R3 核心）
    if (freshTask.version !== input.expectedVersion) {
      throw versionConflictError(freshTask.version);
    }

    // 6. 看板版本检查
    if (locked.boardVersion !== input.expectedBoardVersion) {
      throw boardConflictError(locked.boardVersion);
    }

    // Compare the requested successor with the actual successor before assigning positions.
    if (input.toStatus === freshTask.status) {
      const column = await tx.task.findMany({
        where: { projectId, status: freshTask.status, deletedAt: null },
        orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true },
      });
      const index = column.findIndex(row => row.id === freshTask.id);
      const successor = column[index + 1]?.id ?? null;
      if ((input.beforeTaskId?.toLowerCase() ?? null) === successor) {
              const counts = await fetchTaskResourceCounts(tx, freshTask.id);
              return MoveResultSchema.parse({ task: await toTaskDTO(freshTask, { projectKey: project.key }, counts), boardVersion: locked.boardVersion });
      }
    }
    const newPosition = await computeMovePosition(tx, projectId, input.toStatus, input.beforeTaskId?.toLowerCase() ?? null, normalizedTaskId);

    // 8. 更新任务：status + position + version++ + completedAt 规则
    const completedAtDelta = computeCompletedAt(freshTask.status, input.toStatus, freshTask.completedAt);
    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        status: input.toStatus,
        position: newPosition,
        version: { increment: 1 },
        ...completedAtDelta,
      },
      include: { assignee: { select: { id: true, name: true } }, creator: { select: { id: true, name: true } } },
    });

    // 9. 递增 boardVersion（raw SQL，avoid Project.updatedAt）
    await tx.$executeRaw`UPDATE "Project" SET "boardVersion" = "boardVersion" + 1 WHERE id = ${projectId}::uuid`;
    const newBoardVersion = locked.boardVersion + 1;

    // 10. 写统一 ActivityLog（TASK_MOVED）
    await appendActivity(tx, {
      projectId,
      actorId: userId,
      entityType: "TASK",
      entityId: taskId,
      action: "TASK_MOVED",
      metadata: {
        fromStatus: freshTask.status,
        toStatus: input.toStatus,
        taskIdentifier: formatIdentifier(project.key, freshTask.number),
      },
    });

    // 11. 写入 MoveRecord（审计历史，事务内同原子性）
    await createMoveRecord(tx, {
      taskId,
      fromStatus: freshTask.status,
      toStatus: input.toStatus,
      fromPosition: freshTask.position,
      toPosition: newPosition,
      boardVersion: newBoardVersion,
    });

    // 12. M5: 真实聚合计数（绝不含 position）
    const counts = await fetchTaskResourceCounts(tx, updated.id);
    const result: MoveResultDTO = {
      task: await toTaskDTO(updated, { projectKey: project.key }, counts),
      boardVersion: newBoardVersion,
    };
    return MoveResultSchema.parse(result);
  });
}
