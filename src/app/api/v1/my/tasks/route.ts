import { requireSessionUser } from "@/server/auth/session";
import { listMyTasks } from "@/server/modules/workbench/service";
import { MyTasksQuerySchema, parseQueryParams } from "@/contracts";
import { jsonList, jsonEnvelope } from "@/server/http/json";
import { toErrorResponse } from "@/server/http/errors";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const id = resolveRequestIdFromRequest(request);
  try {
    const user = await requireSessionUser(request);
    const parsed = parseQueryParams(
      MyTasksQuerySchema,
      Object.fromEntries(new URL(request.url).searchParams),
      id,
    );
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, id);
    const result = await listMyTasks(user.id, parsed.data);
    return jsonList(
      result.tasks,
      { requestId: id, nextCursor: result.nextCursor, hasMore: result.hasMore },
      id,
    );
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
