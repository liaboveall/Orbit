import "server-only";
import { Prisma, type Project } from "@/generated/prisma/client";
import { DomainError } from "@/server/http/errors";
import { UuidSchema } from "@/contracts";
import { toProjectRow, type RawProjectRow } from "@/server/db/project-row";
import { decideProjectAccess, type ProjectRole } from "./decide";

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

/**
 * 成员关系的 SQL 片段：原始查询里判定「谁能看到这个项目」只有这两种写法，都从这里取，
 * 规则变化时只改一处。两者都要求查询里 Project 的别名是 `p`。
 *
 * projectMemberSql：userId 是该项目的非 owner 成员（配合 decide.ts 得出角色）。
 * projectVisibleSql：userId 是 owner 或成员（直接用作 WHERE 条件）。
 */
export function projectMemberSql(userId: string): Prisma.Sql {
  return Prisma.sql`(p."ownerId" <> ${userId} AND EXISTS (
    SELECT 1 FROM "ProjectMember" m WHERE m."projectId" = p.id AND m."userId" = ${userId}
  ))`;
}
export function projectVisibleSql(userId: string): Prisma.Sql {
  return Prisma.sql`(p."ownerId" = ${userId} OR EXISTS (
    SELECT 1 FROM "ProjectMember" m WHERE m."projectId" = p.id AND m."userId" = ${userId}
  ))`;
}

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
 * 一条语句同时读取项目行与成员关系（owner 不查成员表）。只读路径用应用单例调用；
 * 写事务里在**已经持有**项目锁之后调用同样成立：READ COMMITTED 下每条语句取新快照，
 * 读到的是持锁后的权威状态。刚拿到锁、手里已有项目行时用 accessForLockedProject，
 * 不必再读一次 Project。
 *
 * projectId 非法 UUID 直接判为不可见（避免 `::uuid` 转换错误冒泡成 500，
 * 也不给探测者「格式错误 vs 不存在」的区分信号）。
 */
export async function resolveProjectAccess(
  client: DbClient,
  projectId: string,
  userId: string,
): Promise<ProjectAccess> {
  if (!UuidSchema.safeParse(projectId).success) throw projectNotFoundError();

  const rows = await client.$queryRaw<Array<RawProjectRow & { isMember: boolean }>>`
    SELECT p.*, ${projectMemberSql(userId)} AS "isMember"
    FROM "Project" p
    WHERE p.id = ${projectId}::uuid
  `;
  const row = rows[0];
  if (!row) throw projectNotFoundError();
  const { isMember, ...project } = toProjectRow(row);
  const role = decideProjectAccess({
    exists: true,
    isOwner: project.ownerId === userId,
    isMember,
  });
  if (role === "NOT_FOUND") throw projectNotFoundError();
  return { project, role };
}

/**
 * 持锁后的授权：项目行来自 lockProjectRow / lockProjectOfTask（已是权威状态），这里只判定
 * 成员关系——owner 不发语句，成员一条语句。
 *
 * 成员关系必须在拿到锁之后用单独的语句读取：与加锁写在同一条语句里的子查询沿用等锁之前
 * 的快照，看不到等锁期间提交的成员移除（docs/05 §4「检查之后成员被移除」的竞争）。
 */
export async function accessForLockedProject(
  tx: DbClient,
  project: Project,
  userId: string,
): Promise<ProjectAccess> {
  const isOwner = project.ownerId === userId;
  let isMember = false;
  if (!isOwner) {
    const membership = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId } },
      select: { id: true },
    });
    isMember = membership !== null;
  }
  const role = decideProjectAccess({ exists: true, isOwner, isMember });
  if (role === "NOT_FOUND") throw projectNotFoundError();
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
