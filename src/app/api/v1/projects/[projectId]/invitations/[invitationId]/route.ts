import { enforceWriteLimit } from "@/server/http/write-limit";
import { requireSessionUser } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/errors";
import { verifyRequestOrigin } from "@/server/http/origin";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { NO_STORE } from "@/server/http/errors";
import { REQUEST_ID_HEADER } from "@/server/http/request-id";
import { revokeInvitation } from "@/server/modules/invitation/service";

/**
 * `/api/v1/projects/[projectId]/invitations/[invitationId]`（M4 / ORB-013）：DELETE 撤销邀请。
 *
 * 契约：contracts/openapi.json `paths./projects/{projectId}/invitations/{invitationId}`
 *  （operationId revokeInvitation）。
 *  - 204 No Content：成功撤销，无响应体。
 *  - owner-only（成员 → 403 FORBIDDEN，非成员/不存在 → 404 NOT_FOUND）。
 *  - 已使用的邀请 → 409 INVITATION_USED。
 *
 * Next.js 16：动态段 `params` 为 Promise，须 `await`。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 动态路由参数（Next.js 16 中为 Promise）。 */
interface RouteContext {
  params: Promise<{ projectId: string; invitationId: string }>;
}

/**
 * DELETE /projects/{projectId}/invitations/{invitationId}：撤销邀请（owner-only）。
 *
 * 顺序：Origin → 会话 → 限流 → 领域服务（授权 + 状态检查 + 撤销 + 活动）。
 */
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const denied = verifyRequestOrigin(request, requestId);
    if (denied) return denied;

    const { projectId, invitationId } = await context.params;
    const sessionUser = await requireSessionUser(request);
    const limited = await enforceWriteLimit(sessionUser.id, requestId);
    if (limited) return limited;

    await revokeInvitation(invitationId, projectId, sessionUser.id);

    // 204 No Content（openapi 契约：成功撤销无响应体）。
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": NO_STORE,
        [REQUEST_ID_HEADER]: requestId,
      },
    });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
