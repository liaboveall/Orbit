import "server-only";
import type { Prisma, Project } from "@/generated/prisma/client";
import { DomainError } from "@/server/http/errors";
import { UuidSchema } from "@/contracts";
import {
  decideProjectAccess,
  decideProjectWrite,
  type ProjectRole,
  type ProjectWriteAction,
} from "./decide";

/**
 * 项目授权 **IO 层**（M2 / ORB-007）。
 *
 * 职责：在传入的 Prisma client（应用单例或事务 tx）上查 Project + ProjectMember，
 * 用 `decide.ts` 的纯函数判定角色与写权限，并把判定结果翻译成领域错误。
 *
 * 安全（docs/03 §5、docs/05 §3）：非成员与不存在**统一** 404 NOT_FOUND，
 * 不泄露项目是否存在；写权限不足 → 403 FORBIDDEN；归档只读 → 409 PROJECT_ARCHIVED。
 *
 * client 形参类型取 `Prisma.TransactionClient`：应用单例 `prisma` 结构上满足该子集，
 * 因此只读路径可直接传 `prisma`，写事务内则传 `tx`（持锁后复查，docs/04 §4）。
 */

/** 事务内/单例皆可的数据库客户端（结构子集，PrismaClient 可赋值）。 */
export type DbClient = Prisma.TransactionClient;

/** 项目不可见（不存在或非成员）——统一 404，不区分二者。 */
export function projectNotFoundError(): DomainError {
  return new DomainError("NOT_FOUND", "项目不存在或你无权访问。");
}

/** 成员执行 owner-only 操作 —— 403 FORBIDDEN。 */
export function projectForbiddenError(): DomainError {
  return new DomainError("FORBIDDEN", "只有项目所有者可以执行该操作。");
}

/** 归档项目写操作 —— 409 PROJECT_ARCHIVED（只读）。 */
export function projectArchivedError(): DomainError {
  return new DomainError("PROJECT_ARCHIVED", "项目已归档，处于只读状态。");
}

/** 授权结果：项目行 + 计算角色。 */
export interface ProjectAccess {
  project: Project;
  role: ProjectRole;
}

/**
 * 解析当前用户对项目的访问角色；非成员/不存在抛 404 NOT_FOUND。
 *
 * projectId 非法 UUID 直接判为不可见（避免 Prisma 转换错误冒泡成 500，
 * 也不给探测者「格式错误 vs 不存在」的区分信号）。
 */
export async function resolveProjectAccess(
  client: DbClient,
  projectId: string,
  userId: string,
): Promise<ProjectAccess> {
  if (!UuidSchema.safeParse(projectId).success) throw projectNotFoundError();

  const project = await client.project.findUnique({ where: { id: projectId } });
  const exists = project !== null;
  const isOwner = project !== null && project.ownerId === userId;

  let isMember = false;
  if (project !== null && !isOwner) {
    const membership = await client.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    isMember = membership !== null;
  }

  const role = decideProjectAccess({ exists, isOwner, isMember });
  if (role === "NOT_FOUND" || project === null) throw projectNotFoundError();
  return { project, role };
}

/**
 * 要求当前用户为项目成员（owner 亦视为成员）；否则 404 NOT_FOUND。
 * 用于所有「读项目/列出成员」等成员可见操作。
 */
export async function requireProjectMember(
  client: DbClient,
  projectId: string,
  userId: string,
): Promise<ProjectAccess> {
  return resolveProjectAccess(client, projectId, userId);
}

/**
 * 要求当前用户为项目 owner；成员 → 403 FORBIDDEN，非成员/不存在 → 404 NOT_FOUND。
 * 用于修改/归档/恢复项目等 owner-only 操作。
 */
export async function requireProjectOwner(
  client: DbClient,
  projectId: string,
  userId: string,
): Promise<ProjectAccess> {
  const access = await resolveProjectAccess(client, projectId, userId);
  if (access.role !== "OWNER") throw projectForbiddenError();
  return access;
}

/**
 * 要求项目对给定写操作可写：先确认 owner（成员 403 / 非成员 404），
 * 再按归档状态与动作判定（归档且非 restore → 409 PROJECT_ARCHIVED）。
 */
export async function requireWritableProject(
  client: DbClient,
  projectId: string,
  userId: string,
  action: ProjectWriteAction,
): Promise<ProjectAccess> {
  const { project, role } = await requireProjectOwner(client, projectId, userId);
  const decision = decideProjectWrite({ role, archivedAt: project.archivedAt, action });
  if (decision === "FORBIDDEN") throw projectForbiddenError();
  if (decision === "ARCHIVED") throw projectArchivedError();
  return { project, role };
}
