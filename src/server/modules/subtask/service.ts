import "server-only";
import type {
  ActivityMetadataField,
  CreateSubtaskDTO,
  SubtaskDTO,
  UpdateSubtaskDTO,
} from "@/contracts";
import { SubtaskSchema, UuidSchema } from "@/contracts";
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
  resolveIdempotencyCommitConflict,
} from "@/server/modules/idempotency/service";
import { MAX_SUBTASKS_PER_TASK } from "@/server/modules/limits";
import { formatIdentifier } from "@/server/modules/task/identifier";
import {
  locateTaskProject,
  requireWritableTaskSubresource,
  resolveReadableTaskSubresource,
  touchTaskUpdatedAt,
} from "@/server/modules/task/subresource";
import {
  countActiveSubtasks,
  subtaskLimitExceededError,
  subtaskNotFoundError,
  subtaskVersionConflictError,
} from "./access";
import { toSubtaskDTO } from "./mappers";

/**
 * 子任务服务（M5 / ORB-016，docs/01 §8、docs/04 §3/§4/§6、docs/05 §5/§6）。
 *
 * 设计要点：
 *  - **独立 version**：子任务自维护乐观并发版本，与父任务 version 完全解耦；
 *    expectedVersion 不符 → 409 VERSION_CONFLICT + details.currentVersion（docs/05 §5）；
 *  - **父状态独立**：勾选/取消子任务**绝不**联动父任务 status —— 父任务状态只由
 *    PATCH /tasks/{id} 与 move 决定（docs/01 §6）。子任务完成度只是展示信息；
 *  - **父任务 updatedAt 同步**：每次子任务写入都刷新父任务 updatedAt，但**不递增
 *    task.version**（docs/04 §4、docs/05 §5），避免与父任务字段编辑互相制造假冲突；
 *  - **稳定排序**：显示顺序恒为 (createdAt, id) 升序，不实现子任务重排（docs/04 §3）；
 *  - **配额锁内判定**：每任务未删除子任务 ≤ 50，在 Project 行锁内计数（docs/04 §6）；
 *  - 软删除：置 deletedAt 并 version++，列表与后续读写一律视为 404。
 *
 * 事务原子序列（锁顺序 Project → Task → 子资源）：
 *   locateTaskProject（锁外只读定位）→ lockProjectRow → requireWritableTaskSubresource
 *   → [幂等 begin] → 配额 → 写子任务 → touchTaskUpdatedAt → 写活动 → [幂等 commit]。
 */

/** 构造 400 VALIDATION_ERROR（字段级提示）。 */
function validationError(fieldErrors: Record<string, string[]>): DomainError {
  return new DomainError("VALIDATION_ERROR", "请求校验未通过，请检查输入后重试。", fieldErrors);
}

/** createSubtask 的幂等 routeKey（docs/04 §3：含真实资源 ID 的规范化路径）。 */
export function createSubtaskRouteKey(taskId: string): string {
  return `POST /tasks/${taskId}/subtasks`;
}

/** createSubtask 结果：DTO + 是否为幂等重放（决定 201 还是 200）。 */
export interface CreateSubtaskResult {
  subtask: SubtaskDTO;
  replayed: boolean;
}

/** 归一化并校验子任务标题：trim 后须 1—200 字符（DB CHECK btrim(title)<>'' 兜底）。 */
function normalizeTitle(raw: string): string {
  const title = raw.trim();
  if (title.length < 1 || title.length > 200) {
    throw validationError({ title: ["子任务标题需为 1—200 个字符"] });
  }
  return title;
}

/**
 * 锁外定位子任务所属 (taskId, projectId)，用于 PATCH/DELETE 满足 Project 先锁的顺序。
 * 非法 UUID / 子任务不存在 → 404。**不做授权**，授权在锁内重做。
 */
async function locateSubtaskProject(
  subtaskId: string,
): Promise<{ taskId: string; projectId: string }> {
  if (!UuidSchema.safeParse(subtaskId).success) throw subtaskNotFoundError();
  const row = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: { taskId: true, task: { select: { projectId: true } } },
  });
  if (!row) throw subtaskNotFoundError();
  return { taskId: row.taskId, projectId: row.task.projectId };
}

/**
 * 列出某任务的全部未删除子任务（稳定升序 createdAt,id）。
 *
 * 无分页：每任务上限 50 条（MAX_SUBTASKS_PER_TASK），一次返回完整清单即可，
 * 契约 listSubtasks 亦返回裸数组 + Meta（无 PageMeta）。
 * 授权：父任务可见即可读；归档项目仍可只读浏览。
 */
export async function listSubtasks(taskId: string, userId: string): Promise<SubtaskDTO[]> {
  await resolveReadableTaskSubresource(taskId, userId);

  const rows = await prisma.subtask.findMany({
    where: { taskId, deletedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toSubtaskDTO);
}

/**
 * 创建子任务（需 Idempotency-Key，docs/05 §5）。
 *
 * @param taskId 父任务 id（路径参数）。
 * @param userId 会话确认的当前用户 id。
 * @param input 已过 CreateSubtaskSchema 形状校验的请求体。
 * @param idempotencyKey 已过 requireIdempotencyKey 校验的合法键。
 */
export async function createSubtask(
  taskId: string,
  userId: string,
  input: CreateSubtaskDTO,
  idempotencyKey: string,
): Promise<CreateSubtaskResult> {
  const projectId = await locateTaskProject(taskId);
  const requestHash = hashRequest(input);
  const routeKey = createSubtaskRouteKey(taskId);
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
      // 重放前已重新确认成员关系、项目可写与父任务可见，可安全回放原结果。
      return { subtask: await readSubtaskReplay(tx, taskId, begin), replayed: true };
    }

    const title = normalizeTitle(input.title);

    // 配额：锁内计数未删除子任务（docs/04 §6），软删除的不占额度。
    if ((await countActiveSubtasks(tx, taskId)) >= MAX_SUBTASKS_PER_TASK) {
      throw subtaskLimitExceededError();
    }

    const created = await tx.subtask.create({
      data: {
        taskId,
        title,
        isCompleted: false,
        version: 1,
      } satisfies Prisma.SubtaskUncheckedCreateInput,
    });

    // 父任务 updatedAt 同步，但不动 task.version（docs/04 §4）。
    await touchTaskUpdatedAt(tx, taskId);

    await appendActivity(tx, {
      projectId,
      actorId: userId,
      entityType: "SUBTASK",
      entityId: created.id,
      action: "SUBTASK_CREATED",
      metadata: { taskIdentifier: formatIdentifier(access.project.key, task.number) },
    });

    const subtask = toSubtaskDTO(created);

    await commitIdempotency(tx, {
      ...idempotencyOpts,
      responseStatus: 201,
      responseBody: subtask,
      resourceId: created.id,
    });

    return { subtask, replayed: false };
  });

  try {
    return await execute();
  } catch (error) {
    // commitIdempotency 撞唯一键（P2002）→ 事务已 aborted，须在事务外复查（见 idempotency/service.ts）。
    if (error instanceof IdempotencyCommitConflictError) {
      const resolved = await resolveIdempotencyCommitConflict(prisma, error.opts);
      return { subtask: SubtaskSchema.parse(resolved.body), replayed: true };
    }
    throw error;
  }
}

/** 幂等重放读取：调用方须已持有项目锁并完成重新鉴权，缓存不得绕过当前可读性。 */
async function readSubtaskReplay(
  tx: Prisma.TransactionClient,
  taskId: string,
  replay: { resourceId: string | null; body: unknown },
): Promise<SubtaskDTO> {
  if (!replay.resourceId) throw subtaskNotFoundError();
  const row = await tx.subtask.findUnique({ where: { id: replay.resourceId } });
  if (!row || row.taskId !== taskId || row.deletedAt !== null) throw subtaskNotFoundError();
  const cached = SubtaskSchema.parse(replay.body);
  if (cached.id !== row.id || cached.taskId !== taskId) throw subtaskNotFoundError();
  return cached;
}

/**
 * 更新子任务标题 / 完成状态。
 *
 * 权限：owner 与 member 均可编辑任意子任务（docs/01 §8），故无作者限制。
 * 并发：expectedVersion 与该子任务自己的 version 比对，不符 → 409 + currentVersion。
 * 无语义变化（规范化后字段全等）→ 不 bump version、不写活动、不刷新父任务 updatedAt。
 */
export async function updateSubtask(
  subtaskId: string,
  userId: string,
  input: UpdateSubtaskDTO,
): Promise<SubtaskDTO> {
  const { taskId, projectId } = await locateSubtaskProject(subtaskId);

  return withTransaction(async (tx) => {
    const locked = await lockProjectRow(tx, projectId);
    if (!locked) throw projectNotFoundError();

    const { task, access } = await requireWritableTaskSubresource(tx, projectId, taskId, userId);

    const subtask = await tx.subtask.findUnique({ where: { id: subtaskId } });
    if (!subtask || subtask.taskId !== taskId || subtask.deletedAt !== null) {
      throw subtaskNotFoundError();
    }

    if (subtask.version !== input.expectedVersion) {
      throw subtaskVersionConflictError(subtask.version);
    }

    const data: Prisma.SubtaskUncheckedUpdateInput = {};
    const changedFields: ActivityMetadataField[] = [];

    if (input.title !== undefined) {
      const title = normalizeTitle(input.title);
      if (title !== subtask.title) {
        data.title = title;
        changedFields.push("title");
      }
    }

    // isCompleted 只改子任务自身；父任务 status 不受影响（docs/01 §6）。
    if (input.isCompleted !== undefined && input.isCompleted !== subtask.isCompleted) {
      data.isCompleted = input.isCompleted;
      changedFields.push("isCompleted");
    }

    // 规范化后无语义变化：不 bump version、不写活动，返回当前数据。
    if (changedFields.length === 0) return toSubtaskDTO(subtask);

    data.version = subtask.version + 1;
    const updated = await tx.subtask.update({ where: { id: subtask.id }, data });

    await touchTaskUpdatedAt(tx, taskId);

    await appendActivity(tx, {
      projectId,
      actorId: userId,
      entityType: "SUBTASK",
      entityId: subtask.id,
      action: "SUBTASK_UPDATED",
      metadata: {
        fields: changedFields,
        taskIdentifier: formatIdentifier(access.project.key, task.number),
      },
    });

    return toSubtaskDTO(updated);
  });
}

/**
 * 软删除子任务（契约返回 204，无响应体）。
 *
 * 权限：owner 与 member 均可删除任意子任务（docs/01 §8）。
 * 并发：expectedVersion 来自 query（docs/05 §5：DELETE 子资源用 query expectedVersion）。
 * 已删除的子任务再次删除 → 404（不是幂等成功），避免掩盖客户端状态过期。
 */
export async function deleteSubtask(
  subtaskId: string,
  userId: string,
  expectedVersion: number,
): Promise<void> {
  const { taskId, projectId } = await locateSubtaskProject(subtaskId);

  await withTransaction(async (tx) => {
    const locked = await lockProjectRow(tx, projectId);
    if (!locked) throw projectNotFoundError();

    const { task, access } = await requireWritableTaskSubresource(tx, projectId, taskId, userId);

    const subtask = await tx.subtask.findUnique({ where: { id: subtaskId } });
    if (!subtask || subtask.taskId !== taskId || subtask.deletedAt !== null) {
      throw subtaskNotFoundError();
    }

    if (subtask.version !== expectedVersion) {
      throw subtaskVersionConflictError(subtask.version);
    }

    await tx.subtask.update({
      where: { id: subtask.id },
      data: { deletedAt: new Date(), version: subtask.version + 1 },
    });

    await touchTaskUpdatedAt(tx, taskId);

    await appendActivity(tx, {
      projectId,
      actorId: userId,
      entityType: "SUBTASK",
      entityId: subtask.id,
      action: "SUBTASK_DELETED",
      metadata: { taskIdentifier: formatIdentifier(access.project.key, task.number) },
    });
  });
}
