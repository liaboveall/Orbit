import { enforceWriteLimit } from "@/server/http/write-limit";
import { parseRequestBody } from "@/contracts";
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

    // expectedVersion from query string
    const url = new URL(request.url);
    const expectedVersionStr = url.searchParams.get("expectedVersion");
    if (!expectedVersionStr) {
      return errorResponse("VALIDATION_ERROR", "expectedVersion query parameter is required", requestId);
    }
    const expectedVersion = Number(expectedVersionStr);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return errorResponse("VALIDATION_ERROR", "expectedVersion must be a positive integer", requestId);
    }

    await deleteComment(commentId, sessionUser.id, expectedVersion);
    return new Response(null, { status: 204 });
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
