import { enforceWriteLimit } from "@/server/http/write-limit";
import { parseRequestBody, parseQueryParams, VersionQuerySchema } from "@/contracts";
import { UpdateCommentSchema } from "@/contracts";
import { errorResponse, toErrorResponse } from "@/server/http/errors";
import { jsonSuccess, readJsonBody, jsonEnvelope } from "@/server/http/json";
import { verifyRequestOrigin } from "@/server/http/origin";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { requireSessionUser } from "@/server/auth/session";
import { updateComment, deleteComment } from "@/server/modules/comments/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ commentId: string }>;
}

/** PATCH /comments/{commentId}：编辑评论（仅作者） */
export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);

  try {
    const denied = verifyRequestOrigin(request, requestId);
    if (denied) return denied;

    const sessionUser = await requireSessionUser(request);
    const limited = await enforceWriteLimit(sessionUser.id, requestId);
    if (limited) return limited;

    const { commentId } = await context.params;

    const raw = await readJsonBody(request);
    if (!raw.ok) {
      if (raw.tooLarge) {
        return errorResponse("PAYLOAD_TOO_LARGE", "请求体超过大小限制。", requestId);
      }
      return errorResponse("VALIDATION_ERROR", "请求体必须是合法的 JSON 对象。", requestId);
    }

    const parsed = parseRequestBody(UpdateCommentSchema, raw.body, requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);

    const comment = await updateComment(commentId, sessionUser.id, parsed.data);
    return jsonSuccess(comment, requestId);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}

/** DELETE /comments/{commentId}：软删除评论（作者或 owner） */
export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);

  try {
    const denied = verifyRequestOrigin(request, requestId);
    if (denied) return denied;

    const sessionUser = await requireSessionUser(request);
    const limited = await enforceWriteLimit(sessionUser.id, requestId);
    if (limited) return limited;

    const { commentId } = await context.params;

    const values = new URL(request.url).searchParams.getAll("expectedVersion");
    const parsed = parseQueryParams(VersionQuerySchema, { expectedVersion: values.length === 1 ? values[0] : undefined }, requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);
    const { expectedVersion } = parsed.data;

    // 契约（contracts/openapi.json DELETE /comments/{commentId}）定义 200 + 删除占位
    // Comment（body=null、isDeleted=true）；服务层返回的即该脱敏 DTO。
    const comment = await deleteComment(commentId, sessionUser.id, expectedVersion);
    return jsonSuccess(comment, requestId);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
