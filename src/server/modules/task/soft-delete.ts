import "server-only";
import { DeletedTaskSchema, UuidSchema, type DeletedTaskDTO } from "@/contracts";
import { DomainError } from "@/server/http/errors";
import { lockProjectOfTask, withTransaction } from "@/server/db/tx";
import { appendActivity } from "@/server/modules/activity/writer";
import {
  canDeleteTask,
  requireWritableTaskProject,
  taskDeleteForbiddenError,
  taskNotFoundError,
} from "./access";
import { formatIdentifier } from "./identifier";

/**
 * 软删除任务服务（M2 / ORB-008，docs/01 §6、docs/04 §3/§4）。
 *
 * 事务原子序列：lockProjectOfTask（按任务定位并锁定项目）→
 *   requireWritableTaskProject（成员 + 非归档）→ 锁内读 Task →
 *   权限（owner 或创建者，否则 403）→ expectedVersion 比对 →
 *   deletedAt=now + version++ + boardVersion++ → 写活动 TASK_DELETED。
 *
 * 不变量：
 *  - 软删除只置 deletedAt，不物理删除；已删除任务再删 → 404（回收站里不重复删）；
 *  - 删除改变看板顺序集合 → boardVersion++（docs/04 §4）；task.version 必增；
 *  - expectedVersion 从**查询参数**读取（openapi deleteTask 定义），由路由层解析后传入。
 */

/** 乐观并发冲突 —— 409 VERSION_CONFLICT（回传 currentVersion）。 */
function versionConflictError(currentVersion: number): DomainError {
  return new DomainError(
    "VERSION_CONFLICT",
    "任务已被更新，请刷新后重试。",
    undefined,
    { currentVersion },
  );
}

/**
 * 软删除任务。
 *
 * @param taskId 路径参数（UUID）。
 * @param userId 会话确认的当前用户 id。
 * @param expectedVersion 查询参数解析出的当前任务版本（integer ≥ 1）。
 */
export async function softDeleteTask(
  taskId: string,
  userId: string,
  expectedVersion: number,
): Promise<DeletedTaskDTO> {
  if (!UuidSchema.safeParse(taskId).success) throw taskNotFoundError();

  return withTransaction(async (tx) => {
    // 按任务定位并锁定所属项目（一条语句）；任务不存在 → 404。
    const locked = await lockProjectOfTask(tx, taskId);
    if (!locked) throw taskNotFoundError();
    const projectId = locked.id;

    const { project, role } = await requireWritableTaskProject(tx, locked, userId);

    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task || task.deletedAt !== null) throw taskNotFoundError();

    // 删除/恢复：仅 owner 或任务创建者（docs/01 §4 权限矩阵）。
    if (!canDeleteTask(role, task.creatorId, userId)) throw taskDeleteForbiddenError();

    if (task.version !== expectedVersion) throw versionConflictError(task.version);

    const deletedAt = new Date();
    const nextVersion = task.version + 1;
    await tx.task.update({
      where: { id: task.id },
      data: { deletedAt, version: nextVersion },
    });
    // 删除改变看板顺序集合 → 与活动同一条语句里 boardVersion++。
    await appendActivity(
      tx,
      {
        projectId,
        actorId: userId,
        entityType: "TASK",
        entityId: task.id,
        action: "TASK_DELETED",
        metadata: { taskIdentifier: formatIdentifier(project.key, task.number) },
      },
      { bumpBoardVersion: true },
    );

    return DeletedTaskSchema.parse({
      id: task.id,
      version: nextVersion,
      deletedAt: deletedAt.toISOString(),
    });
  });
}
