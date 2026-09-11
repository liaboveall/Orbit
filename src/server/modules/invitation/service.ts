import "server-only";
import crypto from "node:crypto";
import { UuidSchema, type PaginationQueryDTO } from "@/contracts";
import type { Prisma } from "@/generated/prisma/client";
import { computeFilterFingerprint, decodeCursor, encodeCursor, invalidCursorError } from "@/server/modules/pagination/cursor";
import { prisma } from "@/server/db/prisma";
import { lockProjectRow, lockUserRow, withTransaction } from "@/server/db/tx";
import { appendActivity } from "@/server/modules/activity/writer";
import { resolveProjectAccess } from "@/server/modules/authorization/project-access";
import { DomainError } from "@/server/http/errors";
import type { InvitationState } from "@/contracts/enums";
import type {
  InvitationDTO,
  InvitePreviewDTO,
  CreatedInvitationDTO,
  AcceptedInvitationDTO,
} from "@/contracts/dto";
import {
  beginIdempotency,
  commitIdempotency,
  hashRequest,
  IdempotencyCommitConflictError,
  resolveIdempotencyCommitConflict,
} from "@/server/modules/idempotency/service";

/**
 * 邀请令牌管理 (M4 / ORB-013)。
 *
 * 安全要求:
 * - 令牌为 32 字节随机值，URL 安全 base64 编码 → 40~128 字符
 * - 数据库仅存储 SHA-256 哈希 (64 字符十六进制)
 * - 明文令牌仅在创建响应返回一次，永不入日志或持久层
 */

/** 过期时间默认值 (天)。 */
export const DEFAULT_EXPIRY_DAYS = 7;

/** 最大活跃邀请数上限 (每个项目)。Per docs/01-PRODUCT-SPEC.md §5 */
const MAX_ACTIVE_INVITATIONS = 20;

/** 最大项目成员数上限 (包括 owner)。Per docs/01-PRODUCT-SPEC.md §5 */
const MAX_PROJECT_MEMBERS = 20;

/** 创建邀请的幂等 routeKey（docs/04 §3：含真实资源 ID 的规范化路径）。
 *
 * A·审查修复：此前是静态常量字符串（不含 projectId），导致同一用户对**不同项目**
 * 复用同一个 Idempotency-Key 时，第二个项目的创建请求会被误判为第一个项目那次调用的
 * 重放（IdempotencyRecord 唯一键 (userId, method, routeKey, key) 对两次调用完全相同），
 * 返回错误项目的邀请数据而不是为第二个项目创建新邀请。改为按 task/create.ts 的既有
 * 惯例，把真实 projectId 编入 routeKey。
 */
export function createInvitationRouteKey(projectId: string): string {
  return `POST /projects/${projectId}/invitations`;
}

/** createInvitation 的结果。 */
export interface CreateInvitationResult {
  data: CreatedInvitationDTO;
  replayed: boolean;
}

/**
 * 生成随机令牌：32 字节 → URL-safe base64。
 *
 * @returns 明文令牌 (仅首次创建响应返回，之后不再使用)
 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * 计算令牌的 SHA-256 哈希。
 *
 * @param token 明文令牌
 * @returns 64 字符小写十六进制哈希串
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** 校验哈希格式是否为 64 位十六进制。 */
export function isValidHash(hash: unknown): boolean {
  return typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash);
}

/**
 * 创建邀请 (仅项目 owner 可操作)。
 *
 * 事务原子序列：lockUserRow → beginIdempotency → 授权 → 配额检查 →
 *   生成令牌 → insert Invitation → 写活动 → commitIdempotency。
 *
 * @param userId 已认证的当前用户 id
 * @param projectId 目标项目 UUID
 * @param idempotencyKey 幂等键 (合法 UUID)
 * @param expiresInDays 过期天数，默认 7
 */
export async function createInvitation(
  userId: string,
  projectId: string,
  idempotencyKey: string,
  expiresInDays: number = DEFAULT_EXPIRY_DAYS,
): Promise<CreateInvitationResult> {
  const requestHash = hashRequest({ projectId, expiresInDays });
  const routeKey = createInvitationRouteKey(projectId);

  const execute = withTransaction(async (tx) => {
    // 锁顺序最前：User（串行化配额计数与幂等记录写入）。
    const lockedUser = await lockUserRow(tx, userId);
    if (!lockedUser) {
      throw new DomainError("NOT_FOUND", "账户不存在或已被删除，请重新登录。");
    }

    const begin = await beginIdempotency(tx, {
      userId,
      method: "POST",
      routeKey,
      key: idempotencyKey,
      requestHash,
    });

    if (begin.kind === "replay") {
      // 重放：token 已首次返回过，不再暴露明文（docs/05 §5）。
      const stored = begin.body as CreatedInvitationDTO;
      return {
        data: { ...stored, token: null, invitePath: null },
        replayed: true,
      };
    }

    // 授权预检（无锁 tx 读取，成员关系/项目存在性判断，不代表最终裁决）。
    const { role: precheckRole } = await resolveProjectAccess(tx, projectId, userId);
    if (precheckRole !== "OWNER") {
      throw new DomainError("FORBIDDEN", "只有项目所有者可以创建邀请。");
    }

    // 锁顺序 User → Project（docs/04 §4）：与 accept/revoke 共用同一把 Project 锁，
    // 使同项目下创建/接受/撤销对彼此可见的活跃邀请数与归档状态形成全序。
    const locked = await lockProjectRow(tx, projectId);
    if (!locked) {
      throw new DomainError("NOT_FOUND", "项目不存在或已被删除。");
    }

    // 持锁后复核授权与归档（防「预检之后成员被移除/项目被归档」竞争）。
    const { project, role } = await resolveProjectAccess(tx, projectId, userId);
    if (role !== "OWNER") {
      throw new DomainError("FORBIDDEN", "只有项目所有者可以创建邀请。");
    }
    if (project.archivedAt !== null) {
      throw new DomainError("PROJECT_ARCHIVED", "项目已归档，处于只读状态。");
    }

    // 检查活跃邀请数超限（未撤销、未接受、未过期）——持 Project 锁后计数，
    // 与并发创建的其它邀请互斥，不会同时突破 MAX_ACTIVE_INVITATIONS。
    const activeCount = await tx.invitation.count({
      where: {
        projectId,
        revokedAt: null,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (activeCount >= MAX_ACTIVE_INVITATIONS) {
      throw new DomainError(
        "LIMIT_EXCEEDED",
        `该项目已有最多 ${MAX_ACTIVE_INVITATIONS} 个未失效邀请，请先撤销部分邀请。`,
      );
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const row = await tx.invitation.create({
      data: {
        projectId,
        createdById: userId,
        tokenHash,
        expiresAt,
      },
    });

    // ❌ INVITATION CREATION IS NOT A MEMBERSHIP EVENT (docs/05 §9)
    // Creating an invitation does not mean anyone joined the project.
    // Only ACCEPTING an invitation creates MEMBER_JOINED activity (see acceptInvitation).

    const invitation = toInvitationDTO(row);
    // 相对路径，由客户端拼接 origin。
    //
    // 安全修复 (R02)：令牌走**哈希片段** `#token=`，不再作为路径段 `/invite/<token>`。
    // 片段不会发往服务端，因此不进入访问日志、Referer 或代理记录。
    // 路径段形式的旧路由 `/invite/[token]` 已随 R02 一并移除，若这里仍返回旧格式，
    // 按契约使用 invitePath 的调用方只会拿到 404（ISS-04）。
    // 字段名与类型不变（string，1—300），仅取值形状随 R02 对齐。
    const invitePath = `/invite#token=${encodeURIComponent(token)}`;
    
    // ⚠️ SECURITY (R01): DO NOT store token or invitePath in idempotency record.
    // First response includes them (user sees link), replay responses omit tokens.
    // Store only the invitation ID + null tokens to prevent leaks.
    await commitIdempotency(tx, {
      userId,
      method: "POST",
      routeKey,
      key: idempotencyKey,
      requestHash,
      responseStatus: 201,
      responseBody: { 
        invitation, 
        token: null,   // ⚠️ REPLAY responses must NEVER include plaintext token
        invitePath: null, // ⚠️ NO plaintext path stored!
      },
      resourceId: row.id,
    });

    // Return with token ONLY for first creation (never stored anywhere)
    return { data: { invitation, token, invitePath }, replayed: false };
  });

  try {
    return await execute;
  } catch (error) {
    if (error instanceof IdempotencyCommitConflictError) {
      const resolved = await resolveIdempotencyCommitConflict(prisma, error.opts);
      const stored = resolved.body as CreatedInvitationDTO;
      return {
        data: { ...stored, token: null, invitePath: null },
        replayed: true,
      };
    }
    throw error;
  }
}

/**
 * 预览邀请匿名访问信息。
 *
 * @param token 明文令牌
 * @returns 不包含敏感字段的基本信息
 */
export async function previewInvitation(token: string): Promise<InvitePreviewDTO> {
  const tokenHash = hashToken(token);

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash },
    include: {
      project: {
        select: {
          name: true,
          archivedAt: true,
        },
      },
      creator: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!invitation) {
    throw new DomainError("NOT_FOUND", "该邀请不存在或已失效。");
  }

  // 状态检查
  if (invitation.acceptedAt !== null) {
    throw new DomainError("INVITATION_USED", "该邀请已被使用。");
  }
  if (invitation.revokedAt !== null) {
    throw new DomainError("INVITATION_REVOKED", "该邀请已被撤销。");
  }
  if (invitation.expiresAt < new Date()) {
    throw new DomainError("INVITATION_EXPIRED", "该邀请已过期。");
  }

  return {
    projectName: invitation.project.name,
    ownerName: invitation.creator.name,
    expiresAt: invitation.expiresAt.toISOString(),
    role: "MEMBER",
    isArchived: invitation.project.archivedAt !== null,
  };
}

/**
 * 接受邀请。
 *
 * 锁顺序（docs/04 §4，与 create/revoke 一致）：先只读定位 projectId，
 * 再锁 Project、锁 Invitation，持锁后重新检查邀请状态、项目归档、
 * 当前成员关系与人数——不允许在获得 Invitation 锁之后再追加 Project 锁
 * （反向锁顺序会与 create/revoke 的 Project→Invitation 顺序产生死锁风险，
 * 也无法阻止不同 token 并发突破配额，见 A02/A03 审查报告）。
 *
 * @param token 明文令牌
 * @param currentUserId 当前登录用户 ID
 */
export async function acceptInvitation(
  token: string,
  currentUserId: string,
): Promise<AcceptedInvitationDTO> {
  const tokenHash = hashToken(token);

  return withTransaction(async (tx) => {
    // STEP 0：无锁只读定位 projectId（token 不存在 → 404，不占用任何锁）。
    const probe = await tx.invitation.findUnique({
      where: { tokenHash },
      select: { projectId: true },
    });
    if (!probe) {
      throw new DomainError("NOT_FOUND", "邀请不存在或已失效");
    }

    // STEP 1：锁 Project（与 create/revoke 共用同一把锁，形成项目级串行化）。
    const lockedProject = await lockProjectRow(tx, probe.projectId);
    if (!lockedProject) {
      throw new DomainError("NOT_FOUND", "邀请不存在或已失效");
    }

    // STEP 2：持 Project 锁后，锁 Invitation 行（同 token 的并发接受在此互斥）。
    const rows = await tx.$queryRawUnsafe<Array<{
      id: string;
      projectId: string;
      tokenHash: string;
      acceptedAt: Date | null;
      acceptedById: string | null;
      expiresAt: Date;
      createdAt: Date;
      revokedAt: Date | null;
    }>>(
      `SELECT * FROM "Invitation" WHERE "tokenHash" = $1 FOR UPDATE`,
      tokenHash,
    );

    const invitationRow = rows[0];
    if (!invitationRow) {
      throw new DomainError("NOT_FOUND", "邀请不存在或已失效");
    }

    // STEP 3：持双锁后重新检查全部条件（锁前的任何读取均视为过期快照）。

    // A. 检查是否已被使用
    if (invitationRow.acceptedAt !== null) {
      // 同一用户重试 → 返回成功而非错误
      if (invitationRow.acceptedById === currentUserId) {
        const membership = await tx.projectMember.findFirst({
          where: {
            projectId: invitationRow.projectId,
            userId: currentUserId,
          },
        });

        if (membership) {
          return {
            projectId: invitationRow.projectId,
            alreadyMember: true,
            createdNewMembership: false,
          };
        }
        // 理论上不应该发生（DB 约束保护）
        throw new DomainError("INVITATION_USED", "邀请已被使用");
      }

      // 不同用户 → INVITATION_USED
      throw new DomainError("INVITATION_USED", "邀请已被使用");
    }

    // B. 检查是否已撤销（在状态变更前）
    if (invitationRow.revokedAt !== null) {
      throw new DomainError("INVITATION_REVOKED", "该邀请已被撤销。");
    }

    // C. 检查是否已过期（在状态变更前）
    if (invitationRow.expiresAt < new Date()) {
      throw new DomainError("INVITATION_EXPIRED", "该邀请已过期。");
    }

    // D. 检查归档状态（持 Project 锁读取的快照，不会有并发归档竞争，见 A03）。
    if (lockedProject.archivedAt !== null) {
      throw new DomainError("PROJECT_ARCHIVED", "归档项目不接受新成员");
    }

    // E. 首先检查是否是所有者（owner 不应有 ProjectMember 行）
    if (currentUserId === lockedProject.ownerId) {
      // 所有者已拥有完全访问权限 → 无需创建 ProjectMember 记录
      // 不消耗 token，直接返回成功
      return {
        projectId: invitationRow.projectId,
        alreadyMember: true,
        createdNewMembership: false,
      };
    }

    // F. 检查是否已是成员（在配额检查之前）
    const existingMembership = await tx.projectMember.findFirst({
      where: {
        projectId: invitationRow.projectId,
        userId: currentUserId,
      },
    });

    if (existingMembership) {
      // 已是成员接受未使用邀请 → 无需创建新记录
      // 不消耗 token，直接返回成功
      return {
        projectId: invitationRow.projectId,
        alreadyMember: true,
        createdNewMembership: false,
      };
    }

    // H. 检查人数配额（持 Project 锁计数，A01：总人数 = owner + ProjectMember 行数；
    // A02：Project 锁使不同 token 的并发接受在此互斥计数，不会同时突破上限）。
    const currentMemberCount = await tx.projectMember.count({
      where: { projectId: invitationRow.projectId },
    });

    if (1 + currentMemberCount >= MAX_PROJECT_MEMBERS) {
      throw new DomainError(
        "LIMIT_EXCEEDED",
        `项目已达最大成员数限制（${MAX_PROJECT_MEMBERS}人）`,
      );
    }

    // I. 原子状态转换（update + create + activity）
    const updatedInvitation = await tx.invitation.update({
      where: { id: invitationRow.id },
      data: {
        acceptedAt: new Date(),
        acceptedById: currentUserId,
      },
    });

    // 验证原子性 - 恰好有一行被更新
    if (!updatedInvitation || !updatedInvitation.acceptedAt) {
      throw new DomainError("INVITATION_USED", "并发请求消耗了邀请");
    }

    const membership = await tx.projectMember.create({
      data: {
        projectId: invitationRow.projectId,
        userId: currentUserId,
        joinedAt: new Date(),
      },
    });

    // 写入 MEMBER_JOINED 活动（仅针对真实加入，不包括重试）
    await appendActivity(tx, {
      projectId: invitationRow.projectId,
      actorId: currentUserId,
      entityType: "MEMBER",
      entityId: membership.id,
      action: "MEMBER_JOINED",
      metadata: {},
    });

    // J. 返回结果（新成员加入）
    return {
      projectId: invitationRow.projectId,
      alreadyMember: false,
      createdNewMembership: true,
    };
  });
}

/**
 * 撤销邀请 (仅项目 owner)。
 *
 * 锁顺序与 create/accept 一致（Project → Invitation）：先锁 Project，
 * 再锁 Invitation 行并持锁重读状态，避免撤销与接受的竞争让二者都返回成功（A04）。
 *
 * @param invitationId 邀请 ID
 * @param projectId 项目 ID (用于授权校验)
 * @param userId 执行操作的用户 ID (必须是 owner)
 */
export async function revokeInvitation(
  invitationId: string,
  projectId: string,
  userId: string,
): Promise<InvitationDTO> {
  return withTransaction(async (tx) => {
    // 锁 Project（与 create/accept 共用同一把锁，形成项目级串行化）。
    const locked = await lockProjectRow(tx, projectId);
    if (!locked) {
      throw new DomainError("NOT_FOUND", "项目不存在或已被删除。");
    }

    // 持锁后复核授权：确认当前用户是项目 owner。
    const { role } = await resolveProjectAccess(tx, projectId, userId);
    if (role !== "OWNER") {
      throw new DomainError("FORBIDDEN", "只有项目所有者可以撤销邀请。");
    }

    // 锁 Invitation 行并重读状态（与 accept 的 FOR UPDATE 互斥）。
    const rows = await tx.$queryRawUnsafe<Array<{
      id: string;
      projectId: string;
      acceptedAt: Date | null;
      revokedAt: Date | null;
      createdById: string;
      createdAt: Date;
      expiresAt: Date;
    }>>(
      `SELECT id, "projectId", "acceptedAt", "revokedAt", "createdById", "createdAt", "expiresAt"
         FROM "Invitation" WHERE id = $1 AND "projectId" = $2 FOR UPDATE`,
      invitationId,
      projectId,
    );
    const invitationRow = rows[0];

    if (!invitationRow) {
      throw new DomainError("NOT_FOUND", "邀请不存在。");
    }

    if (invitationRow.acceptedAt !== null) {
      // 已被消费（可能是刚完成的并发接受）→ 撤销失败，不得覆盖已消费状态。
      throw new DomainError("INVITATION_USED", "已被使用的邀请无法撤销。");
    }

    if (invitationRow.revokedAt !== null) {
      // 幂等：已撤销直接返回当前状态
      return toInvitationDTO({
        id: invitationRow.id,
        projectId: invitationRow.projectId,
        createdById: invitationRow.createdById,
        createdAt: invitationRow.createdAt,
        expiresAt: invitationRow.expiresAt,
        revokedAt: invitationRow.revokedAt,
        acceptedAt: invitationRow.acceptedAt,
      });
    }

    const revoked = await tx.invitation.update({
      where: { id: invitationId },
      data: { revokedAt: new Date() },
    });

    // ❌ REVOKING AN INVITATION IS NOT A MEMBERSHIP EXIT EVENT (docs/05 §9)
    // Revoking an invitation only invalidates it; no one ever joined to leave.
    // Only ACTUAL member departure creates MEMBER_LEFT/MEMBER_REMOVED activities.

    return toInvitationDTO(revoked);
  });
}

/**
 * 列出项目的全部邀请（仅 owner，用于 RSC 管理页）。
 *
 * 授权：非成员/项目不存在统一 404 NOT_FOUND（docs/03 §5、docs/05 §3），
 * 由 resolveProjectAccess 完成，不在本层泄露项目是否存在。
 * 排序：createdAt DESC（最新创建的邀请在前），与前端邀请管理页展示一致。
 *
 * 返回 InvitationDTO[]（永不含明文 token / tokenHash），可直接经 RSC 边界序列化
 * 传给客户端组件。GET /invitations 使用下方分页函数；Server Component 直接调用本函数
 * （与 board/tasks 页直调 getProject/listMembers 同一范式）。
 *
 * @param projectId 目标项目 UUID
 * @param userId 当前会话用户 id（用于成员关系校验）
 */
export async function listInvitations(
  projectId: string,
  userId: string,
): Promise<InvitationDTO[]> {
  // 获取项目访问权限和角色
  const { role } = await resolveProjectAccess(prisma, projectId, userId);
  
  // 严格授权：只有项目所有者可以查看邀请列表
  if (role !== "OWNER") {
    throw new DomainError(
      "FORBIDDEN",
      "只有项目所有者可以查看邀请。",
    );
  }

  const rows = await prisma.invitation.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  return rows.map(toInvitationDTO);
}

/** GET list pagination, ordered deterministically even when timestamps tie. */
export async function listInvitationPage(projectId: string, userId: string, query: PaginationQueryDTO) {
  const { project, role } = await resolveProjectAccess(prisma, projectId, userId);
  if (role !== "OWNER") throw new DomainError("FORBIDDEN", "只有项目所有者可以查看邀请。");
  const fingerprint = computeFilterFingerprint({ projectId: project.id, resource: "invitations" });
  const where: Prisma.InvitationWhereInput = { projectId: project.id };
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor, fingerprint);
    const [timestamp] = cursor.sortValues;
    if (cursor.sortValues.length !== 1 || typeof timestamp !== "string" || !UuidSchema.safeParse(cursor.id).success) throw invalidCursorError();
    const createdAt = new Date(timestamp);
    if (!Number.isFinite(createdAt.getTime())) throw invalidCursorError();
    where.OR = [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: cursor.id } }];
  }
  const limit = query.limit ?? 30;
  const rows = await prisma.invitation.findMany({
    where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1,
    select: { id: true, projectId: true, createdById: true, createdAt: true, expiresAt: true, revokedAt: true, acceptedAt: true },
  });
  const page = rows.slice(0, limit), last = page.at(-1);
  const hasMore = rows.length > limit;
  return { invitations: page.map(toInvitationDTO), hasMore,
    nextCursor: hasMore && last ? encodeCursor([last.createdAt.toISOString()], last.id, fingerprint) : null };
}

/* ── 内部基础设施 ─────────────────────────────────────────────────────────── */

/** Prisma Invitation 行的基础形状（用于 DTO 转换）。 */
interface InvitationRow {
  id: string;
  projectId: string;
  createdById: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  acceptedAt: Date | null;
}

/** 将 Prisma 行转换为契约层 InvitationDTO（日期转 ISO 字符串）。 */
function toInvitationDTO(row: InvitationRow): InvitationDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    state: calculateState(row),
  };
}

/** 根据时间戳字段计算邀请状态。 */
function calculateState(row: {
  revokedAt: Date | null;
  acceptedAt: Date | null;
  expiresAt: Date;
}): InvitationState {
  if (row.acceptedAt !== null) return "USED";
  if (row.revokedAt !== null) return "REVOKED";
  if (new Date() > row.expiresAt) return "EXPIRED";
  return "ACTIVE";
}
