import "server-only";
import {
  MemberSchema,
  UuidSchema,
  type MemberDTO,
  type ProjectDTO,
  type ProjectListQueryDTO,
} from "@/contracts";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import {
  computeFilterFingerprint,
  decodeCursor,
  encodeCursor,
  invalidCursorError,
} from "@/server/modules/pagination/cursor";
import { toProjectRow, type RawProjectRow } from "@/server/db/project-row";
import {
  projectMemberSql,
  projectNotFoundError,
  projectVisibleSql,
} from "@/server/modules/authorization/project-access";
import { toProjectDTO } from "./mappers";

/**
 * 项目读取服务（M2 / ORB-007，docs/05 §4/§6）。
 *
 * 只读路径用应用 Prisma 单例（不开事务）；非成员/不存在统一 404，授权与数据同一条语句读取。
 * 列表用 keyset 游标分页：默认 updatedAt DESC, id DESC，游标绑定 (scope, archived) 过滤指纹。
 */

/** 列表默认与上限（docs/05 §6：默认 30，上限 100）。 */
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/** listProjects 结果：当页数据 + 下一页游标 + 是否还有更多。 */
export interface ProjectListResult {
  projects: ProjectDTO[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** 归一化成员显示名（与 UserDTO 一致的容错，避免历史异常资料使 MemberSchema 复校失败）。 */
function displayName(name: string): string {
  return name.trim().slice(0, 40) || "未设置姓名";
}

/** 按 scope 构造成员关系过滤（all=拥有或参与；owned=拥有；joined=参与）。 */
function membershipWhere(
  scope: NonNullable<ProjectListQueryDTO["scope"]>,
  userId: string,
): Prisma.ProjectWhereInput {
  if (scope === "owned") return { ownerId: userId };
  if (scope === "joined") return { members: { some: { userId } } };
  return { OR: [{ ownerId: userId }, { members: { some: { userId } } }] };
}

/** 按 archived 过滤（exclude=只看未归档；only=只看已归档）。 */
function archivedWhere(
  archived: NonNullable<ProjectListQueryDTO["archived"]>,
): Prisma.ProjectWhereInput {
  return archived === "only" ? { archivedAt: { not: null } } : { archivedAt: null };
}

/**
 * 列出当前用户拥有/参与的项目（keyset 游标分页）。
 *
 * 游标携带 (updatedAt, id) 与过滤指纹；过滤变化或游标损坏 → 400 INVALID_CURSOR。
 */
export async function listProjects(
  userId: string,
  query: ProjectListQueryDTO,
): Promise<ProjectListResult> {
  const scope = query.scope ?? "all";
  const archived = query.archived ?? "exclude";
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const fingerprint = computeFilterFingerprint({ scope, archived });

  const conditions: Prisma.ProjectWhereInput[] = [membershipWhere(scope, userId), archivedWhere(archived)];

  if (query.cursor) {
    const decoded = decodeCursor(query.cursor, fingerprint);
    const [rawUpdatedAt, rawId] = decoded.sortValues;
    if (typeof rawUpdatedAt !== "string" || typeof rawId !== "string") {
      throw invalidCursorError();
    }
    const cursorUpdatedAt = new Date(rawUpdatedAt);
    if (Number.isNaN(cursorUpdatedAt.getTime())) throw invalidCursorError();
    // 游标内部值视为不可信：过滤指纹非 HMAC 可被篡改，非法 id 直接与 @db.Uuid 列比较
    // 会触发 PG 22P02 → 500，故先守卫（失败 → 400 INVALID_CURSOR）。
    if (!UuidSchema.safeParse(decoded.id).success) throw invalidCursorError();
    // keyset：(updatedAt, id) < (cursorUpdatedAt, cursorId)，与 ORDER BY 一致。
    conditions.push({
      OR: [
        { updatedAt: { lt: cursorUpdatedAt } },
        { updatedAt: cursorUpdatedAt, id: { lt: decoded.id } },
      ],
    });
  }

  const rows = await prisma.project.findMany({
    where: { AND: conditions },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: {
      _count: {
        select: {
          members: true,
          // openTaskCount = 未删除且未完成（status ≠ DONE）的任务（docs/04 §3）。
          tasks: { where: { deletedAt: null, status: { not: "DONE" } } },
        },
      },
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const projects = page.map((row) =>
    toProjectDTO(row, {
      viewerId: userId,
      memberCount: 1 + row._count.members,
      openTaskCount: row._count.tasks,
    }),
  );

  let nextCursor: string | null = null;
  if (hasMore) {
    const last = page[page.length - 1];
    if (last) {
      nextCursor = encodeCursor(
        [last.updatedAt.toISOString(), last.id],
        last.id,
        fingerprint,
      );
    }
  }

  return { projects, nextCursor, hasMore };
}

type ProjectWithCounts = RawProjectRow & {
  isMember: boolean;
  memberRows: number;
  openTaskCount: number;
};

/**
 * 读取单个项目（成员可见）；非成员/不存在 → 404 NOT_FOUND。
 * 项目行、成员关系、成员数与未完成任务数来自同一条语句（每个项目页的布局都会调用）。
 * openTaskCount = 未删除且未完成（status ≠ DONE）的任务（docs/04 §3）。
 */
export async function getProject(projectId: string, userId: string): Promise<ProjectDTO> {
  if (!UuidSchema.safeParse(projectId).success) throw projectNotFoundError();
  const rows = await prisma.$queryRaw<ProjectWithCounts[]>`
    SELECT p.*,
      ${projectMemberSql(userId)} AS "isMember",
      (SELECT count(*) FROM "ProjectMember" m WHERE m."projectId" = p.id)::int AS "memberRows",
      (SELECT count(*) FROM "Task" t
         WHERE t."projectId" = p.id AND t."deletedAt" IS NULL AND t.status <> 'DONE')::int AS "openTaskCount"
    FROM "Project" p
    WHERE p.id = ${projectId}::uuid
  `;
  const row = rows[0];
  if (!row) throw projectNotFoundError();
  const { isMember, memberRows, openTaskCount, ...project } = toProjectRow(row);
  if (project.ownerId !== userId && !isMember) throw projectNotFoundError();
  return toProjectDTO(project, {
    viewerId: userId,
    memberCount: 1 + memberRows,
    openTaskCount,
  });
}

/**
 * 列出项目成员（含 owner，docs/05 §4：不向队友披露 email）。
 * 授权：成员/owner 可见，非成员 → 404。owner 排首位，其后按 joinedAt 升序。
 * 授权与名单是同一条语句：查看者不可见该项目时结果为空（owner 行总是存在）。
 */
export async function listMembers(projectId: string, userId: string): Promise<MemberDTO[]> {
  if (!UuidSchema.safeParse(projectId).success) throw projectNotFoundError();
  const rows = await prisma.$queryRaw<
    Array<{ userId: string; name: string; role: "OWNER" | "MEMBER"; joinedAt: Date }>
  >`
    WITH project AS (
      SELECT p.id, p."ownerId", p."createdAt"
      FROM "Project" p
      WHERE p.id = ${projectId}::uuid AND ${projectVisibleSql(userId)}
    )
    SELECT listed."userId", listed.name, listed.role, listed."joinedAt"
    FROM (
      SELECT u.id AS "userId", u.name, 'OWNER' AS role, project."createdAt" AS "joinedAt",
        0 AS rank, NULL::uuid AS "memberId"
      FROM project JOIN "User" u ON u.id = project."ownerId"
      UNION ALL
      SELECT u.id, u.name, 'MEMBER', m."joinedAt", 1, m.id
      FROM project
      JOIN "ProjectMember" m ON m."projectId" = project.id
      JOIN "User" u ON u.id = m."userId"
    ) listed
    ORDER BY listed.rank, listed."joinedAt" ASC, listed."memberId" ASC
  `;
  if (rows.length === 0) throw projectNotFoundError();
  return rows.map((row) =>
    MemberSchema.parse({
      userId: row.userId,
      name: displayName(row.name),
      role: row.role,
      joinedAt: row.joinedAt.toISOString(),
    }),
  );
}
