import { BoardQuerySchema, parseQueryParams } from "@/contracts";
import { requireSessionUser } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/errors";
import { jsonEnvelope, jsonSuccess } from "@/server/http/json";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { getBoard } from "@/server/modules/task/board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const user = await requireSessionUser(request);
    const parsed = parseQueryParams(
      BoardQuerySchema,
      Object.fromEntries(new URL(request.url).searchParams),
      requestId,
    );
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);
    return jsonSuccess(
      await getBoard((await context.params).projectId, user.id, parsed.data),
      requestId,
    );
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
