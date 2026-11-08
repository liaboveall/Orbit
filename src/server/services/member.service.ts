import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { ActivityAction } from "@/contracts";
import { prisma } from "@/server/db/prisma";
import { DomainError } from "@/server/http/errors";
import { lockProjectRow, withTransaction } from "@/server/db/tx";
import { appendActivity } from "@/server/modules/activity/writer";
import { resolveProjectAccess } from "@/server/modules/authorization/project-access";
export { listMembers } from "@/server/modules/project/read";

/**
 * 成员管理服务（M4 / ORB-014）。
 *
 * 职责：
 * - 列出项目成员（含 owner，复用 @/server/modules/project/read）
 * - 移除成员（事务性：清理任务分配 + 写入活动日志）
 * - 验证移除权限
 *
 * 安全：
 * - 所有写操作必须在事务内进行
 * - 使用 SELECT ... FOR UPDATE 处理并发
 * - 活动日志走白名单过滤
 */

/** removeMember 的入参（removedBy 恒等于 requester，故不再单列字段）。 */
export interface RemoveMemberParams {
  /** 项目 ID（UUID）。 */
  projectId: string;
  /** 发起移除者 ID（已由会话确认）：owner 或执行自我退出的成员本人。 */
  requesterId: string;
  /** 目标用户 ID（要被移除/退出的成员）。 */
  targetUserId: string;
}

/**
 * 目标用户是否可被移除（纯验证）：项目所有者永不可被移除。
 *
 * @param ownerId 项目拥有者 ID
 * @param targetUserId 目标用户 ID
 * @returns 是否可移除
 */
export function canRemoveMember(ownerId: string, targetUserId: string): boolean {
  return targetUserId !== ownerId;
}

/**
 * 移除项目成员（或成员自我退出）。
 *
 * 授权（docs/01 §4、docs/05 §4）：
 *  - owner 可移除任意**非 owner** 成员；
 *  - 普通成员仅能移除自己（requesterId === targetUserId，自我退出）；
 *  - 项目所有者永不可被移除（含 owner 自我退出）→ 403 FORBIDDEN；
 *  - 请求者非项目成员/项目不存在 → 404 NOT_FOUND；目标非成员 → 404 NOT_FOUND。
 *
 * 事务原子序列（ReadCommitted + 有限重试，锁顺序 Project → Task，docs/04 §4）：
 *   lockProjectRow（FOR UPDATE）→ 清空目标在本项目的全部任务分配（含软删除任务）
 *   并递增其 version → 删除 ProjectMember → 写入 MEMBER_REMOVED 活动日志。
 *
 * @param params 参数对象
 * @param params.projectId 项目 ID
 * @param params.requesterId 请求移除者的 ID（owner，或自我退出的成员本人）
 * @param params.targetUserId 目标用户的 ID（要移除/退出的用户）
 */
export async function removeMember(params: RemoveMemberParams): Promise<void> {
  const { projectId, requesterId, targetUserId } = params;

  // 1. 解析请求者对项目的访问角色；非成员/不存在 → 404 NOT_FOUND。
  const { project, role } = await resolveProjectAccess(prisma, projectId, requesterId);

  // 2. 项目所有者永不可被移除（含 owner 自我退出）→ 403 FORBIDDEN。
  if (!canRemoveMember(project.ownerId, targetUserId)) {
    throw new DomainError("FORBIDDEN", "不能移除项目所有者。");
  }

  // 3. 授权：owner 可移除任意非 owner 成员；普通成员只能移除自己（自我退出）。
  if (role !== "OWNER" && requesterId !== targetUserId) {
    throw new DomainError("FORBIDDEN", "只有项目所有者可以移除其他成员。");
  }

  // 4. 目标必须确为项目成员（owner 不是 ProjectMember 行）→ 否则 404 NOT_FOUND。
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId: targetUserId } },
    select: { id: true },
  });
  if (!membership) {
    throw new DomainError("NOT_FOUND", "该用户不是项目成员。");
  }

  // 5. 事务性移除（withTransaction：ReadCommitted 隔离 + 死锁/锁超时有限重试）。
  await withTransaction(async (tx: Prisma.TransactionClient) => {
    // ❌ R09 FIX: Lock acquisition BEFORE any authorization re-checks

    // STEP 0: Acquire project row lock FIRST (serializes concurrent writes)
    const locked = await lockProjectRow(tx, project.id);
    if (!locked) throw new DomainError("NOT_FOUND", "项目不存在或你无权访问。");

    // STEP 1: Re-check authorization INSIDE transaction AFTER lock acquisition
    const currentAccess = await resolveProjectAccess(tx, project.id, requesterId);
    if (currentAccess.role !== "OWNER" && requesterId !== targetUserId) {
      // Requester lost authorization while waiting for lock
      throw new DomainError("FORBIDDEN", "权限已失效，无法继续此操作。");
    }

    // STEP 2: Re-check target still exists AND is still member (concurrent removal check)
    const currentMembership = await tx.projectMember.findFirst({
      where: { 
        projectId: project.id, 
        userId: targetUserId 
      },
      select: { id: true },
    });

    if (!currentMembership) {
      // Target removed by concurrent request or never existed
      throw new DomainError("NOT_FOUND", "该用户已不是项目成员。");
    }

    // 5.2 清空目标在本项目的**全部**任务分配（含软删除任务：不加 deletedAt 过滤），并递增 version。
    const affected = await tx.task.updateMany({
      where: { projectId: project.id, assigneeId: targetUserId },
      data: { assigneeId: null, version: { increment: 1 } },
    });

    // 5.3 删除 ProjectMember 记录。
    await tx.projectMember.deleteMany({
      where: { projectId: project.id, userId: targetUserId },
    });

    // ❌ R08-3 FIX: Use different action based on who initiated the exit
    // Self-exit → voluntary departure → MEMBER_LEFT
    // Owner removing other member → forced removal → MEMBER_REMOVED
    const isSelfExit = (requesterId === targetUserId);
    const action: ActivityAction = isSelfExit ? "MEMBER_LEFT" : "MEMBER_REMOVED";

    // 5.4 写入活动日志（metadata 走白名单过滤：仅 targetUserId + count 会入库）
    await appendActivity(tx, {
      projectId: project.id,
      actorId: requesterId,
      entityType: "MEMBER",
      entityId: currentMembership.id, // Use re-fetched membership ID for accuracy
      action,
      metadata: {
        targetUserId,
        count: affected.count,
      },
    });
  });
}
