import { enforceWriteLimit } from "@/server/http/write-limit";
import { requireSessionUser } from "@/server/auth/session";
import { NO_STORE, toErrorResponse } from "@/server/http/errors";
import { verifyRequestOrigin } from "@/server/http/origin";
import { REQUEST_ID_HEADER, resolveRequestIdFromRequest } from "@/server/http/request-id";
import { removeMember } from "@/server/services/member.service";

/**
 * `/api/v1/projects/[projectId]/members/[userId]`（M4 / ORB-014）：DELETE 移除成员或成员自我退出。
 *
 * 契约：contracts/openapi.json `paths./projects/{projectId}/members/{userId}`（operationId removeMember）。
 *  - 204 → 成功，无响应体；
 *  - 请求者非项目成员 / 项目不存在 → 404 NOT_FOUND（不泄露项目是否存在，docs/03 §5、docs/05 §3）；
 *  - 目标非项目成员 → 404 NOT_FOUND；
 *  - 试图移除项目所有者，或普通成员移除他人（非自我退出）→ 403 FORBIDDEN。
 *
 * 授权与事务不变量（清任务分配 + 递增 version + 删成员 + 写活动）由领域服务 `removeMember`
 * 在数据库事务内**权威复核**（含持锁后复查），路由层只做 HTTP 编排（docs/03 §4）。
 *
 * 请求生命周期（写操作）：请求 ID → Origin → 会话 → 写限流 → 领域服务 → 204。
 *
 * Next.js 16：动态段 `params` 为 Promise，须 `await`。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 动态路由参数（Next.js 16 中为 Promise）。 */
interface RouteContext {
  params: Promise<{ projectId: string; userId: string }>;
}

/** 204 No Content（无响应体），仍带 x-request-id 与 no-store 缓存策略，与 HTTP 层一致。 */
function noContent(requestId: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": NO_STORE,
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}

/**
 * DELETE /projects/{projectId}/members/{userId}：移除成员（owner）或成员自我退出。
 *
 * 顺序：Origin → 会话 → 写限流 → 领域服务（授权 + 行锁 + 事务 + 活动）→ 204。
 */
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const denied = verifyRequestOrigin(request, requestId);
    if (denied) return denied;

    const { projectId, userId } = await context.params;
    const sessionUser = await requireSessionUser(request);
    const limited = await enforceWriteLimit(sessionUser.id, requestId);
    if (limited) return limited;

    await removeMember({
      projectId,
      requesterId: sessionUser.id,
      targetUserId: userId,
    });

    return noContent(requestId);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
