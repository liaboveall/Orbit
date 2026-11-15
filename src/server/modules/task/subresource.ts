import "server-only";
import { UuidSchema } from "@/contracts";
import type { Prisma, Project } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import { toProjectRow, type RawProjectRow } from "@/server/db/project-row";
import { lockProjectOfTask } from "@/server/db/tx";
import { decideProjectAccess } from "@/server/modules/authorization/decide";
import {
  type ProjectAccess,
  projectMemberSql,
  projectNotFoundError,
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
 * 锁顺序（docs/04 §4：User → Project → Task → 子资源）：写路径先用 `lockTaskProject`
 * 按任务锁定所属项目（一条语句完成定位与加锁），再由 `requireWritableTaskSubresource`
 * 在锁内权威复核。定位只读 Task.projectId 一列且该列不会改变，不作为授权依据
 * （授权在锁内重做），因此不构成 TOCTOU 漏洞。
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
 * 写路径第一步：按任务锁定所属项目（Project 先于 Task 的锁顺序），返回持锁后的项目行。
 * 非法 UUID / 任务不存在 → 404。**不做授权判断**，授权由 requireWritableTaskSubresource
 * 在持锁后权威完成。
 */
export async function lockTaskProject(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<Project> {
  if (!UuidSchema.safeParse(taskId).success) throw taskNotFoundError();
  const project = await lockProjectOfTask(tx, taskId);
  if (!project) throw taskNotFoundError();
  return project;
}

/**
 * 锁内权威复核子资源写权限：项目成员 + 项目未归档 + 父任务未软删除。
 *
 * @param project 本事务里刚锁定的项目行（lockTaskProject / lockProjectRow 的返回值）。
 */
export async function requireWritableTaskSubresource(
  tx: Prisma.TransactionClient,
  project: Project,
  taskId: string,
  userId: string,
): Promise<TaskSubresourceContext> {
  // 成员可见 + 非归档；非成员/不存在 → 404，归档 → 409 PROJECT_ARCHIVED。
  const access = await requireWritableTaskProject(tx, project, userId);

  const task = await tx.task.findUnique({ where: { id: taskId }, select: taskContextSelect });
  // 父任务软删除后其全部子资源不可写也不可读（docs/01 §8）。
  if (!task || task.deletedAt !== null) throw taskNotFoundError();
  // 防跨项目拼接：taskId 必须真属于已加锁的项目，否则等同不可见。
  if (task.projectId !== project.id) throw taskNotFoundError();

  return { task, access };
}

type ReadableRow = RawProjectRow & {
  taskId: string;
  taskNumber: number;
  taskCreatorId: string;
  taskDeletedAt: Date | null;
  isMember: boolean;
};

/**
 * 只读路径解析宿主任务（不开事务、不加锁）：一条语句读出任务上下文、所属项目与成员关系。
 * 判定顺序与 getTask 一致：任务存在 → 成员关系 → 软删除（docs/05 §4），三者失败都是 404。
 * 读取不要求项目可写：归档项目仍可浏览既有子资源。
 */
export async function resolveReadableTaskSubresource(
  taskId: string,
  userId: string,
): Promise<TaskSubresourceContext> {
  if (!UuidSchema.safeParse(taskId).success) throw taskNotFoundError();

  const rows = await prisma.$queryRaw<ReadableRow[]>`
    SELECT p.*, t.id AS "taskId", t.number AS "taskNumber", t."creatorId" AS "taskCreatorId",
      t."deletedAt" AS "taskDeletedAt",
      ${projectMemberSql(userId)} AS "isMember"
    FROM "Task" t JOIN "Project" p ON p.id = t."projectId"
    WHERE t.id = ${taskId}::uuid
  `;
  const row = rows[0];
  if (!row) throw taskNotFoundError();
  const { taskId: id, taskNumber, taskCreatorId, taskDeletedAt, isMember, ...project } = toProjectRow(row);
  const role = decideProjectAccess({ exists: true, isOwner: project.ownerId === userId, isMember });
  if (role === "NOT_FOUND") throw projectNotFoundError();
  if (taskDeletedAt !== null) throw taskNotFoundError();

  return {
    task: { id, projectId: project.id, number: taskNumber, creatorId: taskCreatorId },
    access: { project, role },
  };
}
