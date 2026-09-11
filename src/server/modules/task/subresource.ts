import "server-only";
import { UuidSchema } from "@/contracts";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import {
  requireProjectMember,
  type ProjectAccess,
} from "@/server/modules/authorization/project-access";
import { requireWritableTaskProject, taskNotFoundError } from "./access";

/**
 * 任务子资源（子任务 / 评论 / 附件）共享授权链（M5，docs/04 §4、docs/05 §4）。
 *
 * docs/05 §4 明确：子资源接口**一律通过父任务的真实归属授权**，不能只验证客户端传来的
 * projectId。因此三个子资源域都经由本模块解析宿主任务，避免各自复制一份授权链而走偏。
 *
 * 统一的可见性规则（docs/01 §8、docs/05 §4）：
 *  - 非法 UUID / 任务不存在 / 当前用户非项目成员 / 父任务已软删除 → 一律 404 NOT_FOUND，
 *    不泄露存在性，也让「成员被移除后」自动失去全部子资源访问权；
 *  - 写操作额外要求项目未归档 → 409 PROJECT_ARCHIVED（归档项目全域只读）。
 *
 * 锁顺序（docs/04 §4：User → Project → Task → 子资源）：写路径必须先用
 * `locateTaskProject` 在**锁外**定位 projectId，再 `lockProjectRow`，最后
 * `requireWritableTaskSubresource` 在锁内权威复核。锁外定位只读 projectId 一列，
 * 不作为授权依据（授权在锁内重做），因此不构成 TOCTOU 漏洞。
 */

/** 子资源宿主任务的最小上下文（授权 + 活动记录 + 计数同步所需字段）。 */
export interface TaskSubresourceContext {
  /** 宿主任务（已确认未软删除且当前用户可见）。 */
  task: { id: string; projectId: string; number: number; creatorId: string };
  /** 所属项目及当前用户角色（用于 owner/作者双轨删除权限判定）。 */
  access: ProjectAccess;
}

/** 宿主任务查询的最小 select（避免把无关字段带进子资源域）。 */
const taskContextSelect = {
  id: true,
  projectId: true,
  number: true,
  creatorId: true,
  deletedAt: true,
} as const;

/**
 * 锁外定位宿主任务所属 projectId（写路径的第一步，满足 Project 先于 Task 的锁顺序）。
 * 非法 UUID / 任务不存在 → 404。**不做授权判断**，授权由锁内的
 * requireWritableTaskSubresource 权威完成。
 */
export async function locateTaskProject(taskId: string): Promise<string> {
  if (!UuidSchema.safeParse(taskId).success) throw taskNotFoundError();
  const locator = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!locator) throw taskNotFoundError();
  return locator.projectId;
}

/**
 * 锁内权威复核子资源写权限：项目成员 + 项目未归档 + 父任务未软删除。
 * 必须在已持有该 projectId 的 Project 行锁的事务内调用。
 *
 * @param projectId 由 locateTaskProject 定位并已加锁的项目 id。
 */
export async function requireWritableTaskSubresource(
  tx: Prisma.TransactionClient,
  projectId: string,
  taskId: string,
  userId: string,
): Promise<TaskSubresourceContext> {
  // 成员可见 + 非归档；非成员/不存在 → 404，归档 → 409 PROJECT_ARCHIVED。
  const access = await requireWritableTaskProject(tx, projectId, userId);

  const task = await tx.task.findUnique({ where: { id: taskId }, select: taskContextSelect });
  // 父任务软删除后其全部子资源不可写也不可读（docs/01 §8）。
  if (!task || task.deletedAt !== null) throw taskNotFoundError();
  // 防跨项目拼接：taskId 必须真属于已加锁的 projectId，否则等同不可见。
  if (task.projectId !== projectId) throw taskNotFoundError();

  return { task, access };
}

/**
 * 只读路径解析宿主任务（不开事务、不加锁，用应用单例）。
 * 顺序与 getTask 一致：先定位最小 projectId，再验成员关系，最后判软删除（docs/05 §4）。
 */
export async function resolveReadableTaskSubresource(
  taskId: string,
  userId: string,
): Promise<TaskSubresourceContext> {
  if (!UuidSchema.safeParse(taskId).success) throw taskNotFoundError();

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: taskContextSelect,
  });
  if (!task) throw taskNotFoundError();

  // 读取不要求项目可写：归档项目仍可浏览既有子资源（只读），故用 requireProjectMember。
  const access = await requireProjectMember(prisma, task.projectId, userId);
  if (task.deletedAt !== null) throw taskNotFoundError();

  return { task, access };
}

/**
 * 同步父任务 updatedAt（docs/04 §4：「评论/子任务写入 … 父任务 updatedAt」）。
 *
 * 关键取舍（docs/05 §5）：子资源变更**只刷新父任务 updatedAt，绝不递增 task.version**。
 * 讨论/清单活动因此不会与父任务标量字段的 expectedVersion 相互制造假冲突。
 * 用裸 SQL 而非 tx.task.update，以确保只触碰 updatedAt 一列、不误写任何其它字段。
 */
export async function touchTaskUpdatedAt(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Task" SET "updatedAt" = CURRENT_TIMESTAMP WHERE id = ${taskId}::uuid
  `;
}
