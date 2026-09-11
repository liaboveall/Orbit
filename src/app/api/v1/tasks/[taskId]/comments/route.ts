import { enforceWriteLimit } from "@/server/http/write-limit";
import { parseRequestBody } from "@/contracts";
import { CreateCommentSchema } from "@/contracts";
import { errorResponse, toErrorResponse } from "@/server/http/errors";
import { jsonCreated, jsonSuccess, readJsonBody, jsonEnvelope, requireIdempotencyKey, jsonList } from "@/server/http/json";
import { verifyRequestOrigin } from "@/server/http/origin";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { requireSessionUser } from "@/server/auth/session";
import { listComments, createComment } from "@/server/modules/comments/service";
import { PaginationQuerySchema } from "@/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

/** 分页查询参数 schema */
const ListCommentsQuerySchema = PaginationQuerySchema;

/** GET /tasks/{taskId}/comments：分页列出评论 */
export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);

  try {
    const denied = verifyRequestOrigin(request, requestId);
    if (denied) return denied;

    const sessionUser = await requireSessionUser(request);
    const { taskId } = await context.params;

    // 解析查询参数
    const url = new URL(request.url);
    const queryResult = ListCommentsQuerySchema.safeParse(Object.fromEntries(url.searchParams));

    if (!queryResult.success) {
      return errorResponse("VALIDATION_ERROR", "Invalid query parameters", requestId);
    }

    const result = await listComments(taskId, sessionUser.id, queryResult.data);
    return jsonList(result.comments, { requestId, nextCursor: result.nextCursor, hasMore: result.hasMore }, requestId);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}

/** POST /tasks/{taskId}/comments：创建评论（需 Idempotency-Key） */
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

    const parsed = parseRequestBody(CreateCommentSchema, raw.body, requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);

    const result = await createComment(
      taskId,
      sessionUser.id,
      parsed.data,
      idempotencyKey,
    );

    if (result.replayed) {
      return jsonSuccess(result.comment, requestId);
    }
    return jsonCreated(result.comment, requestId);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
