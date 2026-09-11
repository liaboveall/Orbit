import { requireSessionUser } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/errors";
import { jsonSuccess } from "@/server/http/json";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { listMembers } from "@/server/services/member.service";

/**
 * `/api/v1/projects/[projectId]/members`（M2 / ORB-007）：GET 列出项目成员。
 *
 * 契约：contracts/openapi.json `paths./projects/{projectId}/members`（operationId listMembers）。
 *  - 200 → `{data: Member[], meta:{requestId}}`（**非分页**，一次返回全部成员）；
 *    owner 排首位（role=OWNER），其后按 joinedAt 升序（role=MEMBER）；不含 email（docs/05 §4）。
 *  - 非成员/不存在 → 404 NOT_FOUND。
 *
 * Next.js 16：动态段 `params` 为 Promise，须 `await`。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 动态路由参数（Next.js 16 中为 Promise）。 */
interface RouteContext {
  params: Promise<{ projectId: string }>;
}

/** GET /projects/{projectId}/members：列出成员（成员/owner 可见；非成员 → 404）。 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const { projectId } = await context.params;
    const sessionUser = await requireSessionUser(request);
    const result = await listMembers(projectId, sessionUser.id);
    return jsonSuccess(result, requestId);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
