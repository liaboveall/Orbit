import "server-only";
import type { TaskDTO, VersionInputDTO } from "@/contracts";
import { UuidSchema } from "@/contracts";
import type { Prisma } from "@/generated/prisma/client";
import { DomainError } from "@/server/http/errors";
import { prisma } from "@/server/db/prisma";
import { lockProjectRow, withTransaction } from "@/server/db/tx";
import { MAX_OPEN_TASKS } from "@/server/modules/limits";
import { appendActivity } from "@/server/modules/activity/writer";
import {
  beginIdempotency,
  commitIdempotency,
  hashRequest,
  IdempotencyCommitConflictError,
} from "@/server/modules/idempotency/service";
import { projectNotFoundError } from "@/server/modules/authorization/project-access";
import {
  canDeleteTask,
  countOpenTasks,
  isAllowedAssignee,
  requireWritableTaskProject,
  taskDeleteForbiddenError,
  taskLimitExceededError,
  taskNotFoundError,
} from "./access";
import { formatIdentifier } from "./identifier";
import { appendToColumnEnd } from "./position";
import { toTaskDTO, fetchTaskResourceCounts } from "./mappers";
import { readTaskReplay } from "./replay";

/**
 * 恢复（撤销软删除）任务服务（M2 / ORB-008，docs/01 §6、docs/04 §3/§4/§5）。
 *
 * 事务原子序列：定位 task→projectId（锁前只读）→ lockProjectRow →
 *   requireWritableTaskProject（成员 + 非归档）→ 锁内复读 Task→
 *   权限（owner 或创建者）→ beginIdempotency（重放短路）→
 *   首次操作要求已删除 → expectedVersion 比对 → 配额计数 →
 *   清 deletedAt + version++ → 原负责人已退项目则置空 → 追加原列尾 position →
 *   boardVersion++ → 写活动 TASK_RESTORED → commitIdempotency。
 *   （当前权限先于重放，重放另检查资源仍可读。）
 *
 * 不变量：
 *  - 仅**已软删除**任务可恢复；未删除任务的新恢复操作 → 404；已完成请求可幂等重放；
 *  - 恢复会占用配额：未删除任务数 ≥ MAX_OPEN_TASKS(1000) → 422 LIMIT_EXCEEDED；
 *  - 原负责人若已退出项目（非 owner 且无 ProjectMember 行）→ assigneeId=null，不复活幽灵分配；
 *  - 恢复把卡片放回**原 status 列尾**并改变看板顺序集合 → boardVersion++；task.version 必增；
 *  - 幂等：同 key 同 body 重放原响应（重放前已过成员/归档复核）。
 */

/** restoreTask 的幂等 routeKey（docs/04 §3：含真实资源 ID 的规范化路径）。 */
export function restoreTaskRouteKey(taskId: string): string {
  return `POST /tasks/${taskId}/restore`;
}

/** restoreTask 的结果：DTO + 是否为幂等重放。 */
export interface RestoreTaskResult {
  task: TaskDTO;
  replayed: boolean;
}

/** 乐观并发冲突 —— 409 VERSION_CONFLICT（回传 currentVersion）。 */
function versionConflictError(currentVersion: number): DomainError {
  return new DomainError(
    "VERSION_CONFLICT",
    "任务已被更新，请刷新后重试。",
    undefined,
    { currentVersion },
  );
}

/** 带 assignee/creator 关系的任务查询 include。 */
const taskInclude = {
  assignee: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
} as const;

/**
 * 恢复软删除的任务。
 *
 * @param taskId 路径参数（UUID）。
 * @param userId 会话确认的当前用户 id。
 * @param input 已过 VersionInputSchema 校验的请求体（expectedVersion 必填 + ≥1）。
 * @param idempotencyKey 已过 requireIdempotencyKey 校验的合法 UUID。
 */
export async function restoreTask(
  taskId: string,
  userId: string,
  input: VersionInputDTO,
  idempotencyKey: string,
): Promise<RestoreTaskResult> {
  if (!UuidSchema.safeParse(taskId).success) throw taskNotFoundError();
  // 锁前只读定位最小 projectId（docs/05 §4）；不存在 → 404。
  const locator = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!locator) throw taskNotFoundError();
  const projectId = locator.projectId;

  const requestHash = hashRequest(input);
  taskId = taskId.toLowerCase();
  const routeKey = restoreTaskRouteKey(taskId);

  const execute = () => withTransaction(async (tx) => {
    const locked = await lockProjectRow(tx, projectId);
    if (!locked) throw projectNotFoundError();

    const { project, role } = await requireWritableTaskProject(tx, projectId, userId);

    // 当前成员与恢复权限先于重放；已恢复状态由幂等记录区分新请求与重试。
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) throw taskNotFoundError();
    // 删除/恢复：仅 owner 或任务创建者（docs/01 §4 权限矩阵）。
    if (!canDeleteTask(role, task.creatorId, userId)) throw taskDeleteForbiddenError();

    const begin = await beginIdempotency(tx, {
      userId,
      method: "POST",
      routeKey,
      key: idempotencyKey,
      requestHash,
    });
    if (begin.kind === "replay") {
      // 已恢复且仍可读才重放；再次删除后不能通过旧结果取回正文。
      return { task: await readTaskReplay(tx, projectId, begin), replayed: true };
    }

    // 没有匹配的完成记录时，才要求当前处于回收站。
    if (task.deletedAt === null) throw taskNotFoundError();

    if (task.version !== input.expectedVersion) throw versionConflictError(task.version);

    // 恢复会占用配额：锁内计数未删除任务（docs/04 §6）。
    if ((await countOpenTasks(tx, projectId)) >= MAX_OPEN_TASKS) throw taskLimitExceededError();

    // 原负责人若已退出项目 → 取消分配，避免复活幽灵 assignee。
    let assigneeId = task.assigneeId;
    if (assigneeId !== null && !(await isAllowedAssignee(tx, project, assigneeId))) {
      assigneeId = null;
    }

    // 放回原 status 列尾（M2 只支持追加，不做中点插入）。
    const position = await appendToColumnEnd(tx, projectId, task.status);
    const nextVersion = task.version + 1;

    const data: Prisma.TaskUncheckedUpdateInput = {
      deletedAt: null,
      version: nextVersion,
      assigneeId,
      position,
    };
    await tx.task.update({ where: { id: task.id }, data });

    // 看板顺序集合变化 → boardVersion++（不 bump Project.updatedAt，docs/04 §4）。
    await tx.$executeRaw`
      UPDATE "Project" SET "boardVersion" = "boardVersion" + 1 WHERE id = ${projectId}::uuid
    `;

    await appendActivity(tx, {
      projectId,
      actorId: userId,
      entityType: "TASK",
      entityId: task.id,
      action: "TASK_RESTORED",
      metadata: { taskIdentifier: formatIdentifier(project.key, task.number) },
    });

    const row = await tx.task.findUniqueOrThrow({
      where: { id: task.id },
      include: taskInclude,
    });
    // M5: 真实聚合计数
    const counts = await fetchTaskResourceCounts(tx, task.id);
    const restored = await toTaskDTO(row, { projectKey: project.key }, counts);

    await commitIdempotency(tx, {
      userId,
      method: "POST",
      routeKey,
      key: idempotencyKey,
      requestHash,
      responseStatus: 200,
      responseBody: restored,
      resourceId: task.id,
    });

    return { task: restored, replayed: false };
  });

  try {
    return await execute();
  } catch (error) {
    // commitIdempotency 撞唯一键（P2002）→ 事务已 aborted，须在事务外复查 hash（见 idempotency/service.ts）。
    if (error instanceof IdempotencyCommitConflictError) {
      // 在新事务和项目锁内重新执行授权、目标可见性及幂等检查。
      return await execute();
    }
    throw error;
  }
}
