import "server-only";
import { DeletedTaskSchema, UuidSchema, type DeletedTaskDTO } from "@/contracts";
import { DomainError } from "@/server/http/errors";
import { prisma } from "@/server/db/prisma";
import { lockProjectRow, withTransaction } from "@/server/db/tx";
import { appendActivity } from "@/server/modules/activity/writer";
import { projectNotFoundError } from "@/server/modules/authorization/project-access";
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
 * 事务原子序列：定位 task→projectId（锁前只读）→ lockProjectRow →
 *   requireWritableTaskProject（成员 + 非归档）→ 锁内复读 Task →
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
  const locator = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!locator) throw taskNotFoundError();
  const projectId = locator.projectId;

  return withTransaction(async (tx) => {
    const locked = await lockProjectRow(tx, projectId);
    if (!locked) throw projectNotFoundError();

    const { project, role } = await requireWritableTaskProject(tx, projectId, userId);

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
    await tx.$executeRaw`
      UPDATE "Project" SET "boardVersion" = "boardVersion" + 1 WHERE id = ${projectId}::uuid
    `;

    await appendActivity(tx, {
      projectId,
      actorId: userId,
      entityType: "TASK",
      entityId: task.id,
      action: "TASK_DELETED",
      metadata: { taskIdentifier: formatIdentifier(project.key, task.number) },
    });

    return DeletedTaskSchema.parse({
      id: task.id,
      version: nextVersion,
      deletedAt: deletedAt.toISOString(),
    });
  });
}
