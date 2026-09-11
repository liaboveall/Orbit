import { errorResponse, toErrorResponse } from "@/server/http/errors";
import { jsonSuccess } from "@/server/http/json";
import { verifyRequestOrigin } from "@/server/http/origin";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { requireSessionUser } from "@/server/auth/session";
import { getWorkbench } from "@/server/modules/workbench/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {}

/** GET /workbench：获取工作台数据（我的任务） */
export async function GET(
  request: Request,
  _context: RouteContext,
): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);

  try {
    // Origin 检查
    const denied = verifyRequestOrigin(request, requestId);
    if (denied) return denied;

    // 会话校验
    const sessionUser = await requireSessionUser(request);

    // 解析查询参数
    const url = new URL(request.url);
    const assigneeIdStr = url.searchParams.get("assigneeId");
    const includeCompletedStr = url.searchParams.get("includeCompleted");

    const options: { assigneeId?: string; includeCompleted?: boolean } = {};
    
    if (assigneeIdStr) {
      options.assigneeId = assigneeIdStr;
    }
    
    if (includeCompletedStr) {
      options.includeCompleted = includeCompletedStr === "true" || includeCompletedStr === "1";
    }

    const result = await getWorkbench(sessionUser.id, options);
    return jsonSuccess(result, requestId);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
