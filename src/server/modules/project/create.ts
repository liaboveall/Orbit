import "server-only";
import type { CreateProjectDTO, ProjectColor, ProjectDTO } from "@/contracts";
import { DomainError } from "@/server/http/errors";
import { MAX_ACTIVE_PROJECTS } from "@/server/modules/limits";
import { prisma } from "@/server/db/prisma";
import { lockUserRow, withTransaction } from "@/server/db/tx";
import { appendActivity } from "@/server/modules/activity/writer";
import {
  beginIdempotency,
  commitIdempotency,
  hashRequest,
  IdempotencyCommitConflictError,
  resolveIdempotencyCommitConflict,
} from "@/server/modules/idempotency/service";
import { resolveProjectAccess } from "@/server/modules/authorization/project-access";
import { toProjectDTO } from "./mappers";

/**
 * 创建项目服务（M2 / ORB-007，docs/01 §4、docs/04 §4/§6、docs/05 §5）。
 *
 * 事务原子序列（无 Project 锁，故用**用户级行锁**串行化配额与幂等，docs/05 §5）：
 *   lockUserRow → beginIdempotency → 配额计数 → insert Project → 写活动 → commitIdempotency。
 *
 * 不变量：
 *  - 每用户未归档项目数 < MAX_ACTIVE_PROJECTS(10)，超限 → 422 LIMIT_EXCEEDED；
 *  - key 全局唯一，冲突 → 409 PROJECT_KEY_TAKEN（服务端先做格式校验给友好错误，DB CHECK 兜底）；
 *  - 幂等：同 key 同 body 重放原响应；重放前**重新授权**（docs/04 §3），退出成员不得借旧缓存读取。
 */

/** 创建项目的幂等 routeKey（docs/04 §3：规范化路径，无资源 ID）。 */
export const CREATE_PROJECT_ROUTE_KEY = "POST /projects";

/** CreateProject.color 未提供时的默认色（Project.color 无 DB 默认，须显式给定）。 */
export const DEFAULT_PROJECT_COLOR: ProjectColor = "BLUE";

/** key 格式（与契约 ProjectKeySchema、DB CHECK 一致）。 */
const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,7}$/;

/** createProject 的结果：DTO + 是否为幂等重放。 */
export interface CreateProjectResult {
  project: ProjectDTO;
  replayed: boolean;
}

/** 未归档项目数超限 —— 422 LIMIT_EXCEEDED。 */
export function projectLimitExceededError(): DomainError {
  return new DomainError(
    "LIMIT_EXCEEDED",
    `已达到未归档项目数量上限（${MAX_ACTIVE_PROJECTS} 个），请先归档部分项目。`,
  );
}

/** key 已被占用 —— 409 PROJECT_KEY_TAKEN。 */
export function projectKeyTakenError(): DomainError {
  return new DomainError("PROJECT_KEY_TAKEN", "该项目标识已被占用，请更换后重试。");
}

/** 是否为 Prisma 唯一约束冲突（P2002）。 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return String((error as { code?: unknown }).code) === "P2002";
}

/**
 * 创建项目。
 *
 * @param userId 已由会话校验确认的当前用户 id（作为 owner，绝不接受请求体传入）。
 * @param input 已过契约 CreateProjectSchema 形状校验的请求体。
 * @param idempotencyKey 已过 requireIdempotencyKey 校验的合法 UUID。
 */
export async function createProject(
  userId: string,
  input: CreateProjectDTO,
  idempotencyKey: string,
): Promise<CreateProjectResult> {
  const requestHash = hashRequest(input);

  const execute = withTransaction(async (tx) => {
    // 锁顺序最前：User（串行化配额计数与幂等记录写入）。
    const lockedUser = await lockUserRow(tx, userId);
    if (!lockedUser) {
      throw new DomainError("NOT_FOUND", "账户不存在或已被删除，请重新登录。");
    }

    const begin = await beginIdempotency(tx, {
      userId,
      method: "POST",
      routeKey: CREATE_PROJECT_ROUTE_KEY,
      key: idempotencyKey,
      requestHash,
    });

    if (begin.kind === "replay") {
      // 重放前重新授权（docs/04 §3、docs/05 §4）：确认该资源对当前用户仍可见。
      const stored = begin.body as { id?: unknown };
      if (typeof stored?.id === "string") {
        await resolveProjectAccess(tx, stored.id, userId);
      }
      return { project: begin.body as ProjectDTO, replayed: true };
    }

    // 服务端先校验 key 格式（友好错误），DB CHECK 作为最终兜底。
    if (!PROJECT_KEY_PATTERN.test(input.key)) {
      throw new DomainError("VALIDATION_ERROR", "请求校验未通过，请检查输入后重试。", {
        key: ["项目标识需为 2—8 位大写字母或数字，且首位为字母"],
      });
    }

    const name = input.name.trim();
    if (name.length < 1 || name.length > 80) {
      throw new DomainError("VALIDATION_ERROR", "请求校验未通过，请检查输入后重试。", {
        name: ["项目名称需为 1—80 个字符"],
      });
    }

    // 配额：**锁内**计数当前用户未归档项目（docs/04 §6）。
    const activeCount = await tx.project.count({
      where: { ownerId: userId, archivedAt: null },
    });
    if (activeCount >= MAX_ACTIVE_PROJECTS) throw projectLimitExceededError();

    const description = input.description?.trim() ?? "";
    const color = input.color ?? DEFAULT_PROJECT_COLOR;

    let row;
    try {
      row = await tx.project.create({
        data: {
          ownerId: userId,
          name,
          key: input.key,
          description,
          color,
          version: 1,
          boardVersion: 1,
          nextTaskNumber: 1,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw projectKeyTakenError();
      throw error;
    }

    // 活动与业务写入同事务（docs/01 §8）。
    await appendActivity(tx, {
      projectId: row.id,
      actorId: userId,
      entityType: "PROJECT",
      entityId: row.id,
      action: "PROJECT_CREATED",
    });

    const project = toProjectDTO(row, { viewerId: userId, memberCount: 1, openTaskCount: 0 });

    await commitIdempotency(tx, {
      userId,
      method: "POST",
      routeKey: CREATE_PROJECT_ROUTE_KEY,
      key: idempotencyKey,
      requestHash,
      responseStatus: 201,
      responseBody: project,
      resourceId: row.id,
    });

    return { project, replayed: false };
  });

  try {
    return await execute;
  } catch (error) {
    // commitIdempotency 撞唯一键（P2002）→ 事务已 aborted，须在事务外复查 hash（见 idempotency/service.ts）。
    // 并发创建的同一项目由同一 user 拥有，回放已提交响应无需额外授权。
    if (error instanceof IdempotencyCommitConflictError) {
      const resolved = await resolveIdempotencyCommitConflict(prisma, error.opts);
      return { project: resolved.body as ProjectDTO, replayed: true };
    }
    throw error;
  }
}
