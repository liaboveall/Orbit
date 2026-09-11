import "server-only";
import { buildErrorResponse } from "@/contracts";
import { getRateLimiter } from "@/server/modules/rate-limit";

export async function enforceWriteLimit(
  userId: string,
  requestId: string,
): Promise<Response | null> {
  const result = await (await getRateLimiter()).checkLimit(userId, "write");
  if (result.allowed) return null;
  return Response.json(
    buildErrorResponse("RATE_LIMITED", "操作过于频繁，请稍后重试。", {
      requestId,
    }),
    {
      status: 429,
      headers: {
        "Retry-After": String(result.resetAfter),
        "Cache-Control": "private, no-store",
        "x-request-id": requestId,
      },
    },
  );
}
