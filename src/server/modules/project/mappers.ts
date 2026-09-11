import "server-only";
import { ProjectSchema, type ProjectDTO, type ProjectRole } from "@/contracts";
import type { Project } from "@/generated/prisma/client";

/**
 * 项目行 → 契约 DTO 映射（M2 / ORB-007，docs/05 §4）。
 *
 * 要点：
 *  - role 是**计算字段**：ownerId === viewerId → OWNER，否则 MEMBER，不写回数据库；
 *  - memberCount = 1（owner）+ ProjectMember 行数（docs/04 §3：ProjectMember 仅存非 owner 成员）；
 *  - openTaskCount = 未删除且未完成（status ≠ DONE）的任务数（docs/04 §3、docs/01 §6）：
 *    由 read 服务查询后传入，本 mapper 只做透传，**签名不变**；
 *  - 出库前一律经契约 ProjectSchema 复校，只暴露白名单字段（不含 reservedBytes/usedBytes 等内部列）。
 */

/** toProjectDTO 的计数与视角选项。 */
export interface ProjectMapperOptions {
  /** 当前查看者 userId，用于计算 role。 */
  viewerId: string;
  /** 成员数（含 owner）：1 + ProjectMember 行数。 */
  memberCount: number;
  /** 未完成任务数（deletedAt 为空且 status ≠ DONE）。 */
  openTaskCount: number;
}

/** 计算查看者对项目的角色。 */
export function projectRoleForViewer(ownerId: string, viewerId: string): ProjectRole {
  return ownerId === viewerId ? "OWNER" : "MEMBER";
}

/** 数据库 Project 行 → 契约 ProjectDTO（经 ProjectSchema 复校）。 */
export function toProjectDTO(row: Project, opts: ProjectMapperOptions): ProjectDTO {
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    key: row.key,
    description: row.description,
    color: row.color,
    ownerId: row.ownerId,
    role: projectRoleForViewer(row.ownerId, opts.viewerId),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    version: row.version,
    boardVersion: row.boardVersion,
    memberCount: opts.memberCount,
    openTaskCount: opts.openTaskCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
