import { enforceWriteLimit } from "@/server/http/write-limit";
import { parseRequestBody, parseQueryParams, VersionQuerySchema } from "@/contracts";
import { UpdateSubtaskSchema } from "@/contracts";
import { errorResponse, toErrorResponse } from "@/server/http/errors";
import { jsonSuccess, readJsonBody, jsonEnvelope, noContent } from "@/server/http/json";
import { verifyRequestOrigin } from "@/server/http/origin";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { requireSessionUser } from "@/server/auth/session";
import { updateSubtask, deleteSubtask } from "@/server/modules/subtask/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ subtaskId: string }>;
}

/** PATCH /subtasks/{subtaskId}：更新子任务 */
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

    const { subtaskId } = await context.params;

    const raw = await readJsonBody(request);
    if (!raw.ok) {
      if (raw.tooLarge) {
        return errorResponse("PAYLOAD_TOO_LARGE", "请求体超过大小限制。", requestId);
      }
      return errorResponse("VALIDATION_ERROR", "请求体必须是合法的 JSON 对象。", requestId);
    }

    const parsed = parseRequestBody(UpdateSubtaskSchema, raw.body, requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);

    const subtask = await updateSubtask(subtaskId, sessionUser.id, parsed.data);
    return jsonSuccess(subtask, requestId);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}

/** DELETE /subtasks/{subtaskId}：软删除子任务 */
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

    const { subtaskId } = await context.params;

    const values = new URL(request.url).searchParams.getAll("expectedVersion");
    const parsed = parseQueryParams(VersionQuerySchema, { expectedVersion: values.length === 1 ? values[0] : undefined }, requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);
    const { expectedVersion } = parsed.data;

    await deleteSubtask(subtaskId, sessionUser.id, expectedVersion);
    return noContent(requestId);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
