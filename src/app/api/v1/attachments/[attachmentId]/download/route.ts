import { toErrorResponse } from "@/server/http/errors";
import { jsonSuccess } from "@/server/http/json";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { requireSessionUser } from "@/server/auth/session";
import { downloadAttachment } from "@/server/modules/attachments/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const user = await requireSessionUser(request);
    return jsonSuccess(
      await downloadAttachment((await context.params).attachmentId, user.id),
      requestId,
    );
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
