import { requireSessionUser } from "@/server/auth/session";
import { NO_STORE, toErrorResponse } from "@/server/http/errors";
import { ifNoneMatchSatisfied, toEtag } from "@/server/http/etag";
import { jsonSuccess } from "@/server/http/json";
import { REQUEST_ID_HEADER, resolveRequestIdFromRequest } from "@/server/http/request-id";
import { getPulse } from "@/server/modules/pulse/service";

/**
 * GET `/api/v1/my/pulse`（operationId getMyPulse）：变更探测。
 *
 * 200 返回 `{data: Pulse, meta}` 并带 `ETag: "<token>"`；请求的 If-None-Match 命中当前
 * 标记时返回 304、无正文。两种响应都是 `private, no-store`：ETag 只用于这次条件比较，
 * 不让任何缓存保存私有内容。会话与读取额度同其它 GET（未登录 → 401 信封）。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const user = await requireSessionUser(request);
    const pulse = await getPulse(user.id);
    const etag = toEtag(pulse.token);
    if (ifNoneMatchSatisfied(request.headers.get("if-none-match"), etag)) {
      return new Response(null, {
        status: 304,
        headers: { etag, "cache-control": NO_STORE, [REQUEST_ID_HEADER]: requestId },
      });
    }
    const response = jsonSuccess(pulse, requestId);
    response.headers.set("etag", etag);
    return response;
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
