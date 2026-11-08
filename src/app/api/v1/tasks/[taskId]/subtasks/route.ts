import { enforceWriteLimit } from "@/server/http/write-limit";
import { parseRequestBody } from "@/contracts";
import { CreateSubtaskSchema } from "@/contracts";
import { errorResponse, toErrorResponse } from "@/server/http/errors";
import { jsonCreated, jsonSuccess, readJsonBody, jsonEnvelope, requireIdempotencyKey } from "@/server/http/json";
import { verifyRequestOrigin } from "@/server/http/origin";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { requireSessionUser } from "@/server/auth/session";
import { listSubtasks, createSubtask } from "@/server/modules/subtask/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

/** GET /tasks/{taskId}/subtasks：列出子任务 */
export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);

  try {
    const sessionUser = await requireSessionUser(request);
    const { taskId } = await context.params;

    const subtasks = await listSubtasks(taskId, sessionUser.id);
    return jsonSuccess(subtasks, requestId);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}

/** POST /tasks/{taskId}/subtasks：创建子任务（需 Idempotency-Key） */
export async function POST(
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

    const { taskId } = await context.params;

    const idempotencyKey = requireIdempotencyKey(request.headers);

    const raw = await readJsonBody(request);
    if (!raw.ok) {
      if (raw.tooLarge) {
        return errorResponse("PAYLOAD_TOO_LARGE", "请求体超过大小限制。", requestId);
      }
      return errorResponse("VALIDATION_ERROR", "请求体必须是合法的 JSON 对象。", requestId);
    }

    const parsed = parseRequestBody(CreateSubtaskSchema, raw.body, requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);

    const result = await createSubtask(
      taskId,
      sessionUser.id,
      parsed.data,
      idempotencyKey,
    );

    if (result.replayed) {
      return jsonSuccess(result.subtask, requestId);
    }
    return jsonCreated(result.subtask, requestId);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
