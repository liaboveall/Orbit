import "server-only";
import type { Prisma, TaskStatus } from "@/generated/prisma/client";
import type { MoveTaskDTO, MoveResultDTO } from "@/contracts";
import { MoveResultSchema, UuidSchema } from "@/contracts";
import { withTransaction, lockProjectOfTask } from "@/server/db/tx";
import { DomainError } from "@/server/http/errors";
import { requireWritableTaskProject, taskNotFoundError } from "./access";
import { buildTaskSummary, fetchTaskExtras } from "./mappers";
import { appendToColumnEnd, renumberColumn, type RawColRow } from "./position";
import { formatIdentifier } from "./identifier";
import { appendActivity } from "@/server/modules/activity/writer";
import { createMoveRecord } from "./move-record";
import { POSITION_GAP } from "@/server/modules/limits";

/** 目标位置不可用 —— 422 INVALID_BOARD_TARGET（字段级提示）。 */
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

/** PostgreSQL signed bigint 上界，留出少量安全余量。 */
const BIGINT_MAX_SAFE = 9223372036854775800n;

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

/** 读取一列的未删除任务（position, id 升序）。须在持有 Project 行锁的事务内调用。 */
async function readColumn(
  tx: Prisma.TransactionClient,
  projectId: string,
  status: TaskStatus,
): Promise<RawColRow[]> {
  return tx.$queryRaw<RawColRow[]>`
    SELECT id, position FROM "Task"
    WHERE "projectId" = ${projectId}::uuid
      AND "deletedAt" IS NULL
      AND status = ${status}::"TaskStatus"
    ORDER BY position ASC, id ASC
  `;
}

/**
 * 在目标列（已去掉被移动任务）里计算插到 beforeTaskId 之前的 position。
 * 在前后邻居之间取整数中点；插首取首项的一半；无整数间隙或逼近 bigint 上界时，
 * 先在同一事务内把目标列按 POSITION_GAP 重新编号（不含被移动任务），再取中点。
 */
async function positionBefore(
  tx: Prisma.TransactionClient,
  projectId: string,
  toStatus: TaskStatus,
  column: RawColRow[],
  beforeTaskId: string,
  movingTaskId: string,
): Promise<bigint> {
  const idx = column.findIndex((row) => row.id === beforeTaskId);
  if (idx === -1) {
    throw validationError({ beforeTaskId: ["目标任务不在指定列中或不存在"] });
  }

  const beforePos = BigInt(column[idx]!.position);
  const prevPos = idx > 0 ? BigInt(column[idx - 1]!.position) : null;
  const midPos = prevPos === null ? beforePos / 2n : (prevPos + beforePos) / 2n;

  // 间隙耗尽：无法在 (prevPos, beforePos) 之间插入一个新整数位置。
  const gapExhausted = prevPos === null ? beforePos < 2n : beforePos - prevPos < 2n;
  if (gapExhausted || midPos > BIGINT_MAX_SAFE - POSITION_GAP * 2n) {
    await renumberColumn(tx, projectId, toStatus, movingTaskId);
    // 重编号后第 idx 项位于 (idx+1)*GAP，其前驱位于 idx*GAP（列首的前驱视为 0）。
    return (BigInt(idx) * POSITION_GAP + BigInt(idx + 1) * POSITION_GAP) / 2n;
  }
  return midPos;
}

/**
 * 计算移动后的 position（E2 验收导出：中点插入/重编号的生产入口）。
 * - beforeTaskId === null → 追加目标列末尾；
 * - 否则读取目标列，取前驱与 beforeTaskId 的中点，间隙耗尽则重编号整列再计算。
 */
export async function computeMovePosition(
  tx: Prisma.TransactionClient,
  projectId: string,
  toStatus: TaskStatus,
  beforeTaskId: string | null,
  movingTaskId: string,
): Promise<bigint> {
  if (beforeTaskId === null) {
    return appendToColumnEnd(tx, projectId, toStatus);
  }
  const before = beforeTaskId.toLowerCase();
  const moving = movingTaskId.toLowerCase();
  if (before === moving) {
    throw validationError({ beforeTaskId: ["不能将任务移动到其自身之前"] });
  }
  const column = (await readColumn(tx, projectId, toStatus)).filter((row) => row.id !== moving);
  return positionBefore(tx, projectId, toStatus, column, before, moving);
}

/**
 * 移动任务（M3 Phase 3 / ORB-011）。
 *
 * 实现要点：
 *  - 契约真源：MoveTaskDTO（expectedVersion + expectedBoardVersion + toStatus + beforeTaskId）
 *  - 响应形状：{task: TaskDTO, boardVersion}（绝不含 position）
 *  - 锁顺序：Project→Task；lockProjectOfTask 一条语句完成「按任务定位项目并加锁」
 *  - 乐观并发：检查任务 version（→ 409 VERSION_CONFLICT）、项目 boardVersion（→ 409 BOARD_CONFLICT）
 *  - 归档规避：requireWritableTaskProject 复核 archivedAt（→ 409 PROJECT_ARCHIVED）
 *  - ActivityLog：TASK_MOVED，同一条语句里 boardVersion++
 *  - 目标列只读一次：既用于「位置没变」的判断，也用于中点计算
 *
 * 约束：position bigint 绝不入 DTO；响应经 MoveResultSchema.parse 校验一次。
 */
export async function moveTask(
  taskId: string,
  userId: string,
  input: MoveTaskDTO,
): Promise<MoveResultDTO> {
  if (!UuidSchema.safeParse(taskId).success) throw taskNotFoundError();
  const movingId = taskId.toLowerCase();
  const beforeId = input.beforeTaskId?.toLowerCase() ?? null;

  return withTransaction(async (tx) => {
    // 1. 按任务定位并锁定项目，拿到权威的 boardVersion / archivedAt / ownerId。
    const locked = await lockProjectOfTask(tx, movingId);
    if (!locked) throw taskNotFoundError();
    const projectId = locked.id;

    // 2. 权限 + 归档检查（锁内权威复核）：非成员 → NOT_FOUND，归档 → PROJECT_ARCHIVED。
    const { project } = await requireWritableTaskProject(tx, locked, userId);

    // 3. 锁内读任务。
    const task = await tx.task.findUnique({ where: { id: movingId } });
    if (!task || task.deletedAt !== null) throw taskNotFoundError();

    // 4. 任务版本与看板版本。
    if (task.version !== input.expectedVersion) throw versionConflictError(task.version);
    if (locked.boardVersion !== input.expectedBoardVersion) {
      throw boardConflictError(locked.boardVersion);
    }

    const respond = async (row: typeof task, boardVersion: number): Promise<MoveResultDTO> => {
      const extras = await fetchTaskExtras(tx, [row]);
      return MoveResultSchema.parse({
        task: { ...buildTaskSummary(row, { projectKey: project.key }, extras), description: row.description },
        boardVersion,
      });
    };

    // 5. 目标位置。列内移动或指定了 beforeTaskId 时读一次目标列；跨列追加只读列尾。
    let newPosition: bigint;
    if (input.toStatus === task.status || beforeId !== null) {
      const column = await readColumn(tx, projectId, input.toStatus);
      if (input.toStatus === task.status) {
        // 请求的后继就是当前后继：没有语义变化，不写活动、不加版本。
        const index = column.findIndex((row) => row.id === task.id);
        const successor = column[index + 1]?.id ?? null;
        if (beforeId === successor) return respond(task, locked.boardVersion);
      }
      if (beforeId === movingId) {
        throw validationError({ beforeTaskId: ["不能将任务移动到其自身之前"] });
      }
      const others = column.filter((row) => row.id !== movingId);
      if (beforeId === null) {
        // 列内移到末尾：其余任务的末项之后（溢出时由 appendToColumnEnd 负责重编号）。
        const last = others.at(-1);
        newPosition =
          last && BigInt(last.position) + POSITION_GAP <= BIGINT_MAX_SAFE
            ? BigInt(last.position) + POSITION_GAP
            : await appendToColumnEnd(tx, projectId, input.toStatus);
      } else {
        newPosition = await positionBefore(tx, projectId, input.toStatus, others, beforeId, movingId);
      }
    } else {
      newPosition = await appendToColumnEnd(tx, projectId, input.toStatus);
    }

    // 6. 更新任务：status + position + version++ + completedAt 规则。
    const updated = await tx.task.update({
      where: { id: movingId },
      data: {
        status: input.toStatus,
        position: newPosition,
        version: { increment: 1 },
        ...computeCompletedAt(task.status, input.toStatus, task.completedAt),
      },
    });
    const newBoardVersion = locked.boardVersion + 1;

    // 7. 活动 TASK_MOVED；同一条语句里 boardVersion++（不 bump Project.updatedAt）。
    await appendActivity(
      tx,
      {
        projectId,
        actorId: userId,
        entityType: "TASK",
        entityId: movingId,
        action: "TASK_MOVED",
        metadata: {
          fromStatus: task.status,
          toStatus: input.toStatus,
          taskIdentifier: formatIdentifier(project.key, task.number),
        },
      },
      { bumpBoardVersion: true },
    );

    // 8. 移动记录（审计历史，事务内同原子性）。
    await createMoveRecord(tx, {
      taskId: movingId,
      fromStatus: task.status,
      toStatus: input.toStatus,
      fromPosition: task.position,
      toPosition: newPosition,
      boardVersion: newBoardVersion,
    });

    return respond(updated, newBoardVersion);
  });
}
