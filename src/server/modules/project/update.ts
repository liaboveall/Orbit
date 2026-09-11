import "server-only";
import { UuidSchema } from "@/contracts";
import type { ActivityMetadataField, ProjectDTO, UpdateProjectDTO } from "@/contracts";
import type { Prisma } from "@/generated/prisma/client";
import { DomainError } from "@/server/http/errors";
import { prisma } from "@/server/db/prisma";
import { lockProjectRow, lockUserRow, withTransaction } from "@/server/db/tx";
import { MAX_ACTIVE_PROJECTS } from "@/server/modules/limits";
import { appendActivity } from "@/server/modules/activity/writer";
import {
  decideProjectWrite,
  type ProjectWriteAction,
} from "@/server/modules/authorization/decide";
import {
  projectArchivedError,
  projectNotFoundError,
  requireProjectOwner,
  resolveProjectAccess,
} from "@/server/modules/authorization/project-access";
import { projectLimitExceededError } from "./create";
import { toProjectDTO } from "./mappers";

/**
 * 更新/归档/恢复项目服务（M2 / ORB-007，docs/01 §4、docs/04 §4、docs/05 §4）。
 *
 * 事务原子序列（锁顺序 User → Project，docs/04 §4）：
 *   [restore 时先 lockUserRow] → lockProjectRow → requireProjectOwner → 归档态判定 →
 *   expectedVersion 比对 → 白名单字段变更 → version++ → 写活动。
 *   restore（archived=false）需在 owner 级串行化配额计数，故必须先取 User 锁；
 *   archive/update 不涉及跨 owner 配额，仅取 Project 锁。
 *
 * 不变量：
 *  - owner-only：成员 → 403 FORBIDDEN，非成员/不存在 → 404 NOT_FOUND；
 *  - 归档项目只读（唯一例外 owner 的 restore）→ 409 PROJECT_ARCHIVED；
 *  - 乐观并发：expectedVersion 不符 → 409 VERSION_CONFLICT（回传 currentVersion）；
 *  - 恢复归档须再过 10 项目配额（docs/01 §4：超限保留归档状态）→ 422 LIMIT_EXCEEDED；
 *  - **规范化后无语义变化**（如把名字改成 trim 后与现值相同）：不 bump version、不写活动，
 *    直接返回当前数据（docs/04 §4）；一次 PATCH 即使改多字段也只 +1 version。
 */

/** 构造 400 VALIDATION_ERROR（字段级提示）。 */
function validationError(fieldErrors: Record<string, string[]>): DomainError {
  return new DomainError("VALIDATION_ERROR", "请求校验未通过，请检查输入后重试。", fieldErrors);
}

/** 由请求体推断写操作类型（archive/restore/update）。 */
function resolveAction(input: UpdateProjectDTO): ProjectWriteAction {
  if (input.archived === true) return "archive";
  if (input.archived === false) return "restore";
  return "update";
}

/**
 * 项目未完成任务数（deletedAt 为空且 status ≠ DONE），口径与 project/read.ts 一致（docs/04 §3）。
 * 须在持有 Project 行锁的 tx 内计数，与写入原子一致。
 */
async function countOpenTasksForProject(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<number> {
  return tx.task.count({
    where: { projectId, deletedAt: null, status: { not: "DONE" } },
  });
}

/**
 * 更新项目资料 / 归档 / 恢复。
 *
 * @param projectId 路径参数（UUID）。
 * @param userId 已由会话确认的当前用户 id。
 * @param input 已过契约 UpdateProjectSchema 形状校验的请求体。
 */
export async function updateProject(
  projectId: string,
  userId: string,
  input: UpdateProjectDTO,
): Promise<ProjectDTO> {
  // 入口形状守卫：非法 UUID → 404，避免 lockProjectRow 的 `${projectId}::uuid` 触发 PG 22P02 → 500。
  if (!UuidSchema.safeParse(projectId).success) throw projectNotFoundError();

  // 锁前无锁成员预检（用应用单例 prisma，非 tx）：非成员/不存在快速拒绝，避免非成员对热门
  // 项目行加排他锁造成 DoS 面；锁内仍以 requireProjectOwner 做权威复核（预检仅为提前拒绝）。
  await resolveProjectAccess(prisma, projectId, userId);

  return withTransaction(async (tx) => {
    // restore（archived=false）会跨 owner 多行计数配额，须先取 User 锁保持 User → Project
    // 全序，避免并发恢复突破 10 项目上限（docs/04:91）。
    if (input.archived === false) {
      const probe = await tx.project.findUnique({
        where: { id: projectId },
        select: { ownerId: true },
      });
      if (!probe) throw projectNotFoundError();
      if ((await lockUserRow(tx, probe.ownerId)) === null) throw projectNotFoundError();
    }

    // 先取 Project 行锁（并发写串行化，docs/04 §4）。
    const locked = await lockProjectRow(tx, projectId);
    if (!locked) throw projectNotFoundError();

    // 持锁后复查授权（防「检查之后成员被移除」竞争，docs/05 §4）。
    const { project } = await requireProjectOwner(tx, projectId, userId);

    const action = resolveAction(input);
    const decision = decideProjectWrite({ role: "OWNER", archivedAt: project.archivedAt, action });
    if (decision === "ARCHIVED") throw projectArchivedError();
    // decision === "FORBIDDEN" 不会发生（requireProjectOwner 已保证 OWNER）。

    if (project.version !== input.expectedVersion) {
      throw new DomainError("VERSION_CONFLICT", "项目已被更新，你的输入已保留，请刷新后重试。", undefined, {
        currentVersion: project.version,
      });
    }

    const data: Prisma.ProjectUpdateInput = {};
    const changedFields: ActivityMetadataField[] = [];

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length < 1 || name.length > 80) {
        throw validationError({ name: ["项目名称需为 1—80 个字符"] });
      }
      if (name !== project.name) {
        data.name = name;
        changedFields.push("name");
      }
    }

    if (input.description !== undefined) {
      const description = input.description.trim();
      if (description.length > 2000) {
        throw validationError({ description: ["项目描述不能超过 2000 个字符"] });
      }
      if (description !== project.description) {
        data.description = description;
        changedFields.push("description");
      }
    }

    if (input.color !== undefined && input.color !== project.color) {
      data.color = input.color;
      changedFields.push("color");
    }

    // 归档/恢复状态迁移（仅当确有状态变化时才计为语义变更）。
    let archiveAction: "archive" | "restore" | null = null;
    if (input.archived === true && project.archivedAt === null) {
      data.archivedAt = new Date();
      archiveAction = "archive";
    } else if (input.archived === false && project.archivedAt !== null) {
      // 恢复：锁内复核配额（当前项目尚在归档态，不计入 active）。
      const activeCount = await tx.project.count({
        where: { ownerId: project.ownerId, archivedAt: null },
      });
      if (activeCount >= MAX_ACTIVE_PROJECTS) throw projectLimitExceededError();
      data.archivedAt = null;
      archiveAction = "restore";
    }

    const memberCount =
      1 + (await tx.projectMember.count({ where: { projectId: project.id } }));
    // openTaskCount 真实计数（口径同 project/read.ts）：避免 PATCH 响应与 GET 自相矛盾。
    const openTaskCount = await countOpenTasksForProject(tx, project.id);

    // 规范化后无语义变化：不 bump version、不写活动，返回当前数据。
    if (changedFields.length === 0 && archiveAction === null) {
      return toProjectDTO(project, { viewerId: userId, memberCount, openTaskCount });
    }

    data.version = project.version + 1;
    const updated = await tx.project.update({ where: { id: project.id }, data });

    if (changedFields.length > 0) {
      await appendActivity(tx, {
        projectId: project.id,
        actorId: userId,
        entityType: "PROJECT",
        entityId: project.id,
        action: "PROJECT_UPDATED",
        metadata: { fields: changedFields },
      });
    }
    if (archiveAction === "archive") {
      await appendActivity(tx, {
        projectId: project.id,
        actorId: userId,
        entityType: "PROJECT",
        entityId: project.id,
        action: "PROJECT_ARCHIVED",
      });
    } else if (archiveAction === "restore") {
      await appendActivity(tx, {
        projectId: project.id,
        actorId: userId,
        entityType: "PROJECT",
        entityId: project.id,
        action: "PROJECT_RESTORED",
      });
    }

    return toProjectDTO(updated, { viewerId: userId, memberCount, openTaskCount });
  });
}
