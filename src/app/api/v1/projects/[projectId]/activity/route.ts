import { PaginationQuerySchema, parseQueryParams } from "@/contracts";
import { requireSessionUser } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/errors";
import { jsonEnvelope, jsonList } from "@/server/http/json";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { listActivities } from "@/server/modules/activity";

/**
 * `/api/v1/projects/[projectId]/activity`（M4 / ORB-011）：GET 分页读取项目活动。
 *
 * 契约：contracts/openapi.json `paths./projects/{projectId}/activity`（operationId listActivity）。
 *  - GET 200 → 列表信封 `{data: Activity[], meta: PageMeta}`（keyset 游标分页，createdAt DESC）。
 *  - 查询参数仅 `cursor`(1–2048) 与 `limit`(int 1–100，默认 30)，契约未定义 entityType/action 过滤，
 *    故用 PaginationQuerySchema（.strict()）校验：未知参数 → 400 VALIDATION_ERROR。
 *  - 未登录 → 401 UNAUTHENTICATED；非成员/项目不存在 → 404 NOT_FOUND（不泄露是否存在）。
 *
 * 请求生命周期（docs/03 §4）：请求 ID → 会话 → schema 校验 → 领域服务（成员授权 + keyset 分页）
 * → DTO → 统一信封。路由层只做 HTTP 编排，与 tasks/route.ts GET 同构。
 *
 * Next.js 16：动态段 `params` 为 Promise，须 `await`。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 动态路由参数（Next.js 16 中为 Promise）。 */
interface RouteContext {
  params: Promise<{ projectId: string }>;
}

/** GET /projects/{projectId}/activity：分页读取项目活动（成员可见；非成员/不存在 → 404）。 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const { projectId } = await context.params;
    const sessionUser = await requireSessionUser(request);

    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const parsed = parseQueryParams(PaginationQuerySchema, params, requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);

    const result = await listActivities({
      projectId,
      actorId: sessionUser.id,
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
    });
    return jsonList(
      result.activities,
      { requestId, nextCursor: result.nextCursor, hasMore: result.hasMore },
      requestId,
    );
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
