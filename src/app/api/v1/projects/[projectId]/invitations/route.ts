import { enforceWriteLimit } from "@/server/http/write-limit";
import { PaginationQuerySchema, parseQueryParams } from "@/contracts";
import { requireSessionUser } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/errors";
import {
  jsonCreated,
  jsonSuccess,
  requireIdempotencyKey,
  jsonList,
  jsonEnvelope,
} from "@/server/http/json";
import { verifyRequestOrigin } from "@/server/http/origin";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { createInvitation, listInvitationPage } from "@/server/modules/invitation/service";

/**
 * `/api/v1/projects/[projectId]/invitations`（M4 / ORB-013）：POST 创建邀请。
 *
 * 契约：contracts/openapi.json `paths./projects/{projectId}/invitations`
 *  （operationId createInvitation）。
 *  - 无请求体；首次 201 返回 CreatedInvitation（含明文 token）；
 *    幂等重放 200 → token/invitePath 为 null（docs/05 §5）。
 *  - owner-only（成员 → 403 FORBIDDEN，非成员/不存在 → 404 NOT_FOUND）。
 *
 * 请求生命周期（docs/03 §4）：请求 ID → Origin → 会话 → 限流 → 幂等键 →
 * 领域服务（锁 + 授权 + 配额 + 令牌生成 + 幂等）→ DTO → 统一信封。
 *
 * Next.js 16：动态段 `params` 为 Promise，须 `await`。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 动态路由参数（Next.js 16 中为 Promise）。 */
interface RouteContext {
  params: Promise<{ projectId: string }>;
}

/** Owner-only metadata; the cursor is a pagination boundary, never authorization. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const { projectId } = await context.params;
    const user = await requireSessionUser(request);
    const parsed = parseQueryParams(PaginationQuerySchema, Object.fromEntries(new URL(request.url).searchParams), requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);
    const page = await listInvitationPage(projectId, user.id, parsed.data);
    return jsonList(page.invitations, { requestId, nextCursor: page.nextCursor, hasMore: page.hasMore }, requestId);
  } catch (error) { return toErrorResponse(error, requestId); }
}

/**
 * POST /projects/{projectId}/invitations：创建邀请（owner-only）。
 *
 * 顺序：Origin → 会话 → 限流 → Idempotency-Key → 领域服务。
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const denied = verifyRequestOrigin(request, requestId);
    if (denied) return denied;

    const { projectId } = await context.params;
    const sessionUser = await requireSessionUser(request);
    const limited = await enforceWriteLimit(sessionUser.id, requestId);
    if (limited) return limited;
    const idempotencyKey = requireIdempotencyKey(request.headers);

    const { data, replayed } = await createInvitation(
      sessionUser.id,
      projectId,
      idempotencyKey,
    );

    // 201 新建成功；200 幂等重放（docs/05 §2/§5）。
    return replayed ? jsonSuccess(data, requestId) : jsonCreated(data, requestId);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
