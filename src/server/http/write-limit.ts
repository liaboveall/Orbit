import "server-only";
import { buildErrorResponse } from "@/contracts";
import { getRateLimiter } from "@/server/modules/rate-limit";
import { MemoryRateLimiter } from "@/server/modules/rate-limit/memory";

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

/**
 * 匿名邀请端点独立限流器（A07 审查修复，docs/03 §8：20 次/IP/分钟）。
 *
 * 不复用 getRateLimiter() 的全局单例：那是共享用户写桶（60/分钟，`enforceWriteLimit`
 * 用），若在此处以不同 maxTokens 传参会因单例已初始化而被忽略、或反过来把首次初始化的
 * maxTokens 錘死成 20 污染所有业务写限流。匿名端点没有会话可归属用户桶，必须是完全独立
 * 的限流器实例与独立的 20/分钟额度。
 */
const anonymousState = globalThis as typeof globalThis & {
  __orbitAnonymousInviteRateLimiter__?: MemoryRateLimiter;
};

function getAnonymousInviteRateLimiter(): MemoryRateLimiter {
  anonymousState.__orbitAnonymousInviteRateLimiter__ ??= new MemoryRateLimiter({
    maxTokens: 20,
    refillIntervalMs: 60000,
  });
  return anonymousState.__orbitAnonymousInviteRateLimiter__;
}

/**
 * 匿名邀请端点限流（/invitations/preview 等）：按 client-ip 解析出的桶 key 限流，
 * 独立于业务写限流的用户桶。
 */
export async function enforceAnonymousInviteLimit(
  clientIpBucketKey: string,
  requestId: string,
): Promise<Response | null> {
  const result = await getAnonymousInviteRateLimiter().checkLimit(
    clientIpBucketKey,
    "anonymous-invite",
  );
  if (result.allowed) return null;
  return Response.json(
    buildErrorResponse("RATE_LIMITED", "请求过于频繁，请稍后重试。", {
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
