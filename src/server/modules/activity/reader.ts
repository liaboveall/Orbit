import "server-only";
import {
  ActivitySchema,
  UuidSchema,
  type ActivityDTO,
} from "@/contracts";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import { requireProjectMember } from "@/server/modules/authorization/project-access";
import {
  computeFilterFingerprint,
  decodeCursor,
  encodeCursor,
  invalidCursorError,
} from "@/server/modules/pagination/cursor";

/**
 * 活动读取服务（M4 / ORB-011，docs/05 §9、contracts/openapi.json `listActivity`）。
 *
 * 契约（openapi `GET /projects/{projectId}/activity`）：
 *  - 200 → 列表信封 `{data: Activity[], meta: PageMeta}`；
 *  - 查询参数仅 `cursor`(1–2048) 与 `limit`(int 1–100，默认 30)，**无** entityType/action 过滤；
 *  - Activity 形状见 contracts ActivitySchema（actor 为 UserSummary，metadata 为 ActivityMetadata）。
 *
 * 授权：成员可见（owner 亦为成员），非成员/不存在统一 404 NOT_FOUND（docs/03 §5、docs/05 §3），
 * 由 requireProjectMember 完成，不在本层泄露项目是否存在。
 *
 * 分页：keyset 游标（不透明串），排序 createdAt DESC, id DESC —— 与 ActivityLog
 * `@@index([projectId, createdAt(desc), id(desc)])` 对齐；游标绑定 projectId 过滤指纹，
 * 过滤变化或游标损坏 → 400 INVALID_CURSOR（与 listProjects/listProjectTasks 同一套基础设施）。
 */

/** 列表默认与上限（docs/05 §6、openapi default:30 / maximum:100）。 */
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/** ActivityLog 行（含 actor 精简字段）——避免使用 any，精确描述 include 后的形状。 */
type ActivityRow = Prisma.ActivityLogGetPayload<{
  include: { actor: { select: { id: true; name: true } } };
}>;

/** listActivities 的入参。 */
export interface ActivityListOptions {
  /** 目标项目 id（授权与过滤均基于此）。 */
  projectId: string;
  /** 当前会话用户 id，用于成员关系校验（非成员 → 404）。 */
  actorId: string;
  /** 不透明分页游标（可选）。 */
  cursor?: string;
  /** 每页条数（可选，默认 30，上限 100）。 */
  limit?: number;
}

/** listActivities 结果：当页数据 + 下一页游标 + 是否还有更多（供列表信封 PageMeta 使用）。 */
export interface ActivityListResult {
  activities: ActivityDTO[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** 归一化显示名（与 UserSummary 的 min(1)/max(40) 一致，容错历史异常资料）。 */
function displayName(name: string): string {
  return name.trim().slice(0, 40) || "未设置姓名";
}

/**
 * 数据库 ActivityLog 行（含 actor）→ 契约 ActivityDTO（出库前经 ActivitySchema 复校）。
 * metadata 为 jsonb（JsonValue），空值兜底为 {}；写入侧已按白名单过滤，故复校恒通过。
 */
function toActivityDTO(row: ActivityRow): ActivityDTO {
  return ActivitySchema.parse({
    id: row.id,
    projectId: row.projectId,
    actor: { id: row.actor.id, name: displayName(row.actor.name) },
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt.toISOString(),
  });
}

/**
 * 分页读取项目活动（keyset 游标，createdAt DESC, id DESC）。
 * 授权：成员可见（非成员/不存在 → 404）；游标损坏/过滤不匹配 → 400 INVALID_CURSOR。
 */
export async function listActivities(
  options: ActivityListOptions,
): Promise<ActivityListResult> {
  const { projectId, actorId } = options;
  // 成员关系校验：非成员/不存在统一 404，不泄露项目是否存在。
  await requireProjectMember(prisma, projectId, actorId);

  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const fingerprint = computeFilterFingerprint({ projectId });

  const conditions: Prisma.ActivityLogWhereInput[] = [{ projectId }];

  if (options.cursor) {
    const decoded = decodeCursor(options.cursor, fingerprint);
    const [rawCreatedAt, rawId] = decoded.sortValues;
    if (typeof rawCreatedAt !== "string" || typeof rawId !== "string") {
      throw invalidCursorError();
    }
    const cursorCreatedAt = new Date(rawCreatedAt);
    if (Number.isNaN(cursorCreatedAt.getTime())) throw invalidCursorError();
    // 游标内部值视为不可信：过滤指纹非 HMAC 可被篡改，非法 id 直接与 @db.Uuid 列比较
    // 会触发 PG 22P02 → 500，故先守卫（失败 → 400 INVALID_CURSOR）。
    if (!UuidSchema.safeParse(decoded.id).success) throw invalidCursorError();
    // keyset：(createdAt, id) < (cursorCreatedAt, cursorId)，与 ORDER BY 一致。
    conditions.push({
      OR: [
        { createdAt: { lt: cursorCreatedAt } },
        { createdAt: cursorCreatedAt, id: { lt: decoded.id } },
      ],
    });
  }

  const rows = await prisma.activityLog.findMany({
    where: { AND: conditions },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1, // 多取一条以判定 hasMore
    include: { actor: { select: { id: true, name: true } } },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const activities = page.map(toActivityDTO);

  let nextCursor: string | null = null;
  if (hasMore) {
    const last = page[page.length - 1];
    if (last) {
      nextCursor = encodeCursor(
        [last.createdAt.toISOString(), last.id],
        last.id,
        fingerprint,
      );
    }
  }

  return { activities, nextCursor, hasMore };
}
