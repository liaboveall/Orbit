import { requireSessionUser } from "@/server/auth/session";
import { getOverview } from "@/server/modules/workbench/service";
import { jsonSuccess } from "@/server/http/json";
import { toErrorResponse } from "@/server/http/errors";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const id = resolveRequestIdFromRequest(request);
  try {
    return jsonSuccess(
      await getOverview((await requireSessionUser(request)).id),
      id,
    );
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
