import { toErrorResponse } from "@/server/http/errors";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { requireSessionUser } from "@/server/auth/session";
import { downloadContent } from "@/server/modules/attachments/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function HEAD(request: Request) {
  // F03：与其他响应一致携带 x-request-id（405 是方法不允许，不下载文件）。
  return new Response(null, {
    status: 405,
    headers: { Allow: "GET", "Cache-Control": "private, no-store", "X-Request-Id": resolveRequestIdFromRequest(request) },
  });
}
export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const user = await requireSessionUser(request),
      url = new URL(request.url);
    const { stream, contentLength, fileName } = await downloadContent(
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
        // F15：长度可信时携带 Content-Length，截断由 HTTP 层暴露，而非交付损坏文件。
        ...(contentLength !== null ? { "Content-Length": String(contentLength) } : {}),
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
