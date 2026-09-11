import "server-only";
import type { ActivityMetadataField, TaskDTO, UpdateTaskDTO } from "@/contracts";
import { UuidSchema } from "@/contracts";
import type { Prisma } from "@/generated/prisma/client";
import { DomainError } from "@/server/http/errors";
import { prisma } from "@/server/db/prisma";
import { lockProjectRow, withTransaction } from "@/server/db/tx";
import { appendActivity } from "@/server/modules/activity/writer";
import { projectNotFoundError } from "@/server/modules/authorization/project-access";
import {
  assertAssigneeAllowed,
  requireWritableTaskProject,
  taskNotFoundError,
} from "./access";
import { formatIdentifier } from "./identifier";
import { appendToColumnEnd } from "./position";
import { fromDueDateString, toDueDateString } from "./date-only";
import { toTaskDTO } from "./mappers";

/**
 * 更新任务服务（M2 / ORB-008，docs/01 §6、docs/04 §3/§4/§5）。
 *
 * 事务原子序列：定位 task→projectId（锁前只读）→ lockProjectRow →
 *   requireWritableTaskProject（成员 + 非归档）→ 锁内复读 Task → expectedVersion 比对 →
 *   白名单字段变更（title/description/status/priority/assigneeId/dueDate）→
 *   必要时重排 position + boardVersion++ → version++（一次 PATCH 只 +1）→ 写活动 TASK_UPDATED。
 *
 * 不变量：
 *  - 不存在/非法 UUID/已软删除 → 404；expectedVersion 不符 → 409 VERSION_CONFLICT + currentVersion；
 *  - assigneeId 有值须为成员（→ 422 ASSIGNEE_NOT_MEMBER），null 表示取消分配；
 *  - 进入 DONE → completedAt=now；离开 DONE → completedAt=null；重复设相同 status 不刷新；
 *  - 改 status → 追加目标列尾 + boardVersion++（docs/04 §5：PATCH 改状态复用移动语义）；
 *  - **规范化后无语义变化** → 不 bump version、不写活动，返回当前数据。
 */

/** 构造 400 VALIDATION_ERROR（字段级提示）。 */
function validationError(fieldErrors: Record<string, string[]>): DomainError {
  return new DomainError("VALIDATION_ERROR", "请求校验未通过，请检查输入后重试。", fieldErrors);
}

/** 乐观并发冲突 —— 409 VERSION_CONFLICT（回传 currentVersion）。 */
function versionConflictError(currentVersion: number): DomainError {
  return new DomainError(
    "VERSION_CONFLICT",
    "任务已被更新，你的输入已保留，请刷新后重试。",
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
 * 更新任务字段。
 *
 * @param taskId 路径参数（UUID）。
 * @param userId 会话确认的当前用户 id。
 * @param input 已过 UpdateTaskSchema 形状校验的请求体（expectedVersion 必填 + ≥1 变更字段）。
 */
export async function updateTask(
  taskId: string,
  userId: string,
  input: UpdateTaskDTO,
): Promise<TaskDTO> {
  if (!UuidSchema.safeParse(taskId).success) throw taskNotFoundError();
  // 锁前只读定位最小 projectId（docs/05 §4）；不存在 → 404。
  const locator = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!locator) throw taskNotFoundError();
  const projectId = locator.projectId;

  return withTransaction(async (tx) => {
    const locked = await lockProjectRow(tx, projectId);
    if (!locked) throw projectNotFoundError();

    const { project } = await requireWritableTaskProject(tx, projectId, userId);

    const task = await tx.task.findUnique({ where: { id: taskId }, include: taskInclude });
    if (!task || task.deletedAt !== null) throw taskNotFoundError();

    if (task.version !== input.expectedVersion) throw versionConflictError(task.version);

    const data: Prisma.TaskUncheckedUpdateInput = {};
    const changedFields: ActivityMetadataField[] = [];

    if (input.title !== undefined) {
      const title = input.title.trim();
      if (title.length < 1 || title.length > 120) {
        throw validationError({ title: ["任务标题需为 1—120 个字符"] });
      }
      if (title !== task.title) {
        data.title = title;
        changedFields.push("title");
      }
    }

    if (input.description !== undefined) {
      const description = input.description.trim();
      if (description.length > 10000) {
        throw validationError({ description: ["任务描述不能超过 10000 个字符"] });
      }
      if (description !== task.description) {
        data.description = description;
        changedFields.push("description");
      }
    }

    if (input.priority !== undefined && input.priority !== task.priority) {
      data.priority = input.priority;
      changedFields.push("priority");
    }

    if (input.dueDate !== undefined) {
      const currentDue = task.dueDate ? toDueDateString(task.dueDate) : null;
      const nextDue = input.dueDate ?? null;
      if (nextDue !== currentDue) {
        data.dueDate = nextDue ? fromDueDateString(nextDue) : null;
        changedFields.push("dueDate");
      }
    }

    if (input.assigneeId !== undefined) {
      const nextAssignee = input.assigneeId ?? null;
      if (nextAssignee !== task.assigneeId) {
        await assertAssigneeAllowed(tx, project, nextAssignee);
        data.assigneeId = nextAssignee;
        changedFields.push("assigneeId");
      }
    }

    // status 变更：驱动 completedAt 与看板重排（docs/01 §6、docs/04 §5）。
    let statusChanged = false;
    const fromStatus = task.status;
    let toStatus = task.status;
    if (input.status !== undefined && input.status !== task.status) {
      statusChanged = true;
      toStatus = input.status;
      data.status = toStatus;
      data.completedAt = toStatus === "DONE" ? new Date() : null;
      changedFields.push("status");
    }

    // 规范化后无语义变化：不 bump version、不写活动，返回当前数据。
    if (changedFields.length === 0) {
      return toTaskDTO(task, { projectKey: project.key });
    }

    data.version = task.version + 1;
    if (statusChanged) {
      data.position = await appendToColumnEnd(tx, projectId, toStatus);
    }

    const updated = await tx.task.update({ where: { id: task.id }, data });

    if (statusChanged) {
      await tx.$executeRaw`
        UPDATE "Project" SET "boardVersion" = "boardVersion" + 1 WHERE id = ${projectId}::uuid
      `;
    }

    const metadata: Record<string, unknown> = {
      fields: changedFields,
      taskIdentifier: formatIdentifier(project.key, task.number),
    };
    if (statusChanged) {
      metadata.fromStatus = fromStatus;
      metadata.toStatus = toStatus;
    }
    await appendActivity(tx, {
      projectId,
      actorId: userId,
      entityType: "TASK",
      entityId: task.id,
      action: "TASK_UPDATED",
      metadata,
    });

    const row = await tx.task.findUniqueOrThrow({
      where: { id: updated.id },
      include: taskInclude,
    });
    return toTaskDTO(row, { projectKey: project.key });
  });
}
