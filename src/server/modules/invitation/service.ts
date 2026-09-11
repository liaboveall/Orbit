import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/server/db/prisma";
import { lockUserRow, withTransaction } from "@/server/db/tx";
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

/** 创建邀请的幂等 routeKey。 */
export const CREATE_INVITATION_ROUTE_KEY = "POST /projects/:projectId/invitations";

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

  const execute = withTransaction(async (tx) => {
    // 锁顺序最前：User（串行化配额计数与幂等记录写入）。
    const lockedUser = await lockUserRow(tx, userId);
    if (!lockedUser) {
      throw new DomainError("NOT_FOUND", "账户不存在或已被删除，请重新登录。");
    }

    const begin = await beginIdempotency(tx, {
      userId,
      method: "POST",
      routeKey: CREATE_INVITATION_ROUTE_KEY,
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

    // 授权：只有项目 owner 可以创建邀请。
    const { project, role } = await resolveProjectAccess(tx, projectId, userId);
    if (role !== "OWNER") {
      throw new DomainError("FORBIDDEN", "只有项目所有者可以创建邀请。");
    }
    if (project.archivedAt !== null) {
      throw new DomainError("PROJECT_ARCHIVED", "项目已归档，处于只读状态。");
    }

    // 检查活跃邀请数超限（未撤销、未接受、未过期）
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
      routeKey: CREATE_INVITATION_ROUTE_KEY,
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
 * @param token 明文令牌
 * @param currentUserId 当前登录用户 ID
 */
export async function acceptInvitation(
  token: string,
  currentUserId: string,
): Promise<AcceptedInvitationDTO> {
  const tokenHash = hashToken(token);

  return withTransaction(async (tx) => {
    // STEP 1: FOR UPDATE 锁定邀请行，防止并发竞态（使用原始 SQL 绕过 Prisma）
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
      tokenHash
    );

    const invitationRow = rows[0];
    if (!invitationRow) {
      throw new DomainError("NOT_FOUND", "邀请不存在或已失效");
    }

    // STEP 2: 在持锁状态下重新检查所有条件

    // A. 检查是否已被使用
    if (invitationRow.acceptedAt !== null) {
      // 同一用户重试 → 返回成功而非错误
      if (invitationRow.acceptedById === currentUserId) {
        const membership = await tx.projectMember.findFirst({
          where: { 
            projectId: invitationRow.projectId, 
            userId: currentUserId 
          }
        });
        
        if (membership) {
          return { 
            projectId: invitationRow.projectId,
            alreadyMember: true,
            createdNewMembership: false
          };
        } else {
          // 理论上不应该发生（DB 约束保护）
          throw new DomainError("INVITATION_USED", "邀请已被使用");
        }
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

    // D. 检查归档状态（在检查 owner/成员/配额之前）
    const project = await tx.project.findUnique({
      where: { id: invitationRow.projectId }
    });
    
    if (!project || project.archivedAt !== null) {
      throw new DomainError("PROJECT_ARCHIVED", "归档项目不接受新成员");
    }

    // E. 首先检查是否是所有者（owner 不应有 ProjectMember 行）
    if (currentUserId === project.ownerId) {
      // 所有者已拥有完全访问权限 → 无需创建 ProjectMember 记录
      // 不消耗 token，直接返回成功
      return { 
        projectId: invitationRow.projectId,
        alreadyMember: true,
        createdNewMembership: false
      };
    }

    // F. 检查是否已是成员（在配额检查之前）
    const existingMembership = await tx.projectMember.findFirst({
      where: { 
        projectId: invitationRow.projectId, 
        userId: currentUserId 
      }
    });
    
    if (existingMembership) {
      // 已是成员接受未使用邀请 → 无需创建新记录
      // 不消耗 token，直接返回成功
      return { 
        projectId: invitationRow.projectId,
        alreadyMember: true,
        createdNewMembership: false
      };
    }

    // H. NOW check quota（仅在非 owner 且非成员时检查）
    const currentMemberCount = await tx.projectMember.count({
      where: { projectId: invitationRow.projectId }
    });
    
    if (currentMemberCount >= MAX_PROJECT_MEMBERS) {
      throw new DomainError(
        "LIMIT_EXCEEDED",
        `项目已达最大成员数限制（${MAX_PROJECT_MEMBERS}人）`
      );
    }

    // I. 原子状态转换（update + create + activity）
    const updatedInvitation = await tx.invitation.update({
      where: { id: invitationRow.id },
      data: { 
        acceptedAt: new Date(), 
        acceptedById: currentUserId 
      }
    });

    // 验证原子性 - 恰好有一行被更新
    if (!updatedInvitation || !updatedInvitation.acceptedAt) {
      throw new DomainError("INVITATION_USED", "并发请求消耗了邀请");
    }

    const membership = await tx.projectMember.create({
      data: { 
        projectId: invitationRow.projectId, 
        userId: currentUserId, 
        joinedAt: new Date() 
      }
    });

    // 写入 MEMBER_JOINED 活动（仅针对真实加入，不包括重试）
    await appendActivity(tx, {
      projectId: invitationRow.projectId,
      actorId: currentUserId,
      entityType: "MEMBER",
      entityId: membership.id,
      action: "MEMBER_JOINED",
      metadata: {}
    });

    // J. 返回结果（新成员加入）
    return { 
      projectId: invitationRow.projectId,
      alreadyMember: false,
      createdNewMembership: true
    };
  });
}

/**
 * 撤销邀请 (仅项目 owner)。
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
    // 授权：确认当前用户是项目 owner
    const { role } = await resolveProjectAccess(tx, projectId, userId);
    if (role !== "OWNER") {
      throw new DomainError("FORBIDDEN", "只有项目所有者可以撤销邀请。");
    }

    const invitation = await tx.invitation.findFirst({
      where: { id: invitationId, projectId },
    });

    if (!invitation) {
      throw new DomainError("NOT_FOUND", "邀请不存在。");
    }

    if (invitation.acceptedAt !== null) {
      throw new DomainError("INVITATION_USED", "已被使用的邀请无法撤销。");
    }

    if (invitation.revokedAt !== null) {
      // 幂等：已撤销直接返回当前状态
      return toInvitationDTO(invitation);
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
 * 列出项目的全部邀请（成员可见；owner 亦为成员）。
 *
 * 授权：非成员/项目不存在统一 404 NOT_FOUND（docs/03 §5、docs/05 §3），
 * 由 resolveProjectAccess 完成，不在本层泄露项目是否存在。
 * 排序：createdAt DESC（最新创建的邀请在前），与前端邀请管理页展示一致。
 *
 * 返回 InvitationDTO[]（永不含明文 token / tokenHash），可直接经 RSC 边界序列化
 * 传给客户端组件。当前无独立 GET /invitations 端点，Server Component 直接调用本函数
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
    orderBy: { createdAt: "desc" },
  });

  return rows.map(toInvitationDTO);
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
