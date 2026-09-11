import "server-only";
import type { Prisma, Project } from "@/generated/prisma/client";
import { DomainError } from "@/server/http/errors";
import { MAX_OPEN_TASKS } from "@/server/modules/limits";
import {
  projectArchivedError,
  requireProjectMember,
  type ProjectAccess,
} from "@/server/modules/authorization/project-access";

/**
 * 任务域共享授权与校验辅助（M2 / ORB-008，docs/01 §4/§6、docs/04 §4）。
 *
 * 与**项目**写操作（owner-only）不同，任务写操作的权限矩阵是：
 *  - 创建/编辑/分配任意任务：owner 与 member 均可（docs/01 §4）；
 *  - 删除/恢复任务：owner，或该任务的创建者（member 仅能删/恢复自己创建的）；
 *  - 归档项目对**所有**业务写操作只读 → 409 PROJECT_ARCHIVED（docs/01 §6）。
 * 因此这里不复用 owner-only 的 requireWritableProject，而是「成员可见 + 非归档」组合，
 * 再叠加任务级的创建者/owner 删除权限判定。
 */

/** 任务不可见（不存在、非法 UUID、非成员或已软删除）——统一 404，不泄露存在性。 */
export function taskNotFoundError(): DomainError {
  return new DomainError("NOT_FOUND", "任务不存在或你无权访问。");
}

/** 未删除任务数超上限 —— 422 LIMIT_EXCEEDED。 */
export function taskLimitExceededError(): DomainError {
  return new DomainError(
    "LIMIT_EXCEEDED",
    `已达到项目未删除任务数量上限（${MAX_OPEN_TASKS} 个），请先删除部分任务。`,
  );
}

/** 负责人不是项目 owner/成员 —— 422 ASSIGNEE_NOT_MEMBER。 */
export function assigneeNotMemberError(): DomainError {
  return new DomainError(
    "ASSIGNEE_NOT_MEMBER",
    "负责人必须是项目所有者或当前成员，请从成员列表中选择。",
  );
}

/** member 删除/恢复非本人创建的任务 —— 403 FORBIDDEN。 */
export function taskDeleteForbiddenError(): DomainError {
  return new DomainError("FORBIDDEN", "只有项目所有者或任务创建者可以执行该操作。");
}

/**
 * 要求项目对任务写操作可用：先确认当前用户为成员（owner 亦视为成员，非成员/不存在 → 404），
 * 再拒绝归档项目的一切业务写（→ 409 PROJECT_ARCHIVED）。须在持有 Project 行锁的事务内调用。
 */
export async function requireWritableTaskProject(
  tx: Prisma.TransactionClient,
  projectId: string,
  userId: string,
): Promise<ProjectAccess> {
  const access = await requireProjectMember(tx, projectId, userId);
  if (access.project.archivedAt !== null) throw projectArchivedError();
  return access;
}

/** 判定某 userId 是否可作为该项目任务的负责人：项目 owner 或 ProjectMember 行存在。 */
export async function isAllowedAssignee(
  tx: Prisma.TransactionClient,
  project: Project,
  userId: string,
): Promise<boolean> {
  if (userId === project.ownerId) return true;
  const membership = await tx.projectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId } },
    select: { id: true },
  });
  return membership !== null;
}

/** 校验负责人归属；非成员 → 422 ASSIGNEE_NOT_MEMBER。assigneeId 为 null 时不校验（取消分配）。 */
export async function assertAssigneeAllowed(
  tx: Prisma.TransactionClient,
  project: Project,
  assigneeId: string | null,
): Promise<void> {
  if (assigneeId === null) return;
  if (!(await isAllowedAssignee(tx, project, assigneeId))) throw assigneeNotMemberError();
}

/** 统计项目未删除任务数（配额判定用，须在锁内调用以保证与写入原子一致，docs/04 §4）。 */
export async function countOpenTasks(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<number> {
  return tx.task.count({ where: { projectId, deletedAt: null } });
}

/** 任务级删除/恢复权限：owner 或任务创建者。返回是否放行。 */
export function canDeleteTask(
  role: ProjectAccess["role"],
  taskCreatorId: string,
  userId: string,
): boolean {
  return role === "OWNER" || taskCreatorId === userId;
}
