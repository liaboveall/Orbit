import { toErrorResponse } from "@/server/http/errors";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { requireSessionUser } from "@/server/auth/session";
import { downloadContent } from "@/server/modules/attachments/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const user = await requireSessionUser(request),
      url = new URL(request.url);
    const { stream, fileName } = await downloadContent(
      (await context.params).attachmentId,
      user.id,
      url.searchParams.get("expires") ?? "",
      url.searchParams.get("signature") ?? "",
      request.signal,
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition":
          "attachment; filename*=UTF-8''" + encodeURIComponent(fileName),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
