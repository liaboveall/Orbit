import "server-only";
import { buildErrorResponse } from "@/contracts";
import { getRateLimiter } from "@/server/modules/rate-limit";
import { MemoryRateLimiter } from "@/server/modules/rate-limit/memory";
import { consumeBucket, sharedLimitsEnabled } from "@/server/modules/rate-limit/postgres";

export async function enforceWriteLimit(
  userId: string,
  requestId: string,
): Promise<Response | null> {
  const result = sharedLimitsEnabled()
    ? await consumeBucket((await import("@/server/db/prisma")).prisma, "write", userId, 60)
    : await (await getRateLimiter()).checkLimit(userId, "write");
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
 *
 * 口径（A10 修复明确记录，docs/03 §8 原文「邀请预览/接受 20 次/IP/分钟」是**一条**
 * 规则、按 IP 合计计数，不是给 preview 和 accept 各自 20 次的两条独立规则）：
 *  - `/invitations/preview` 与 `/invitations/accept` **共享同一个** MemoryRateLimiter
 *    实例（本文件模块级单例）与同一个 bucketId（"anonymous-invite"）——同一 IP 在
 *    一分钟内对这两个端点发出的请求合计不超过 20 次，不是各 20 次共 40 次。
 *  - `/invitations/accept` 额外**同时**受 enforceWriteLimit（60/用户/分钟）约束：
 *    两条限流互相独立生效，任一先触发即以该结果的 429 返回（先查 IP 桶、再查用户桶，
 *    见 accept/route.ts 的调用顺序），不是「满足其一即可跳过另一个」。
 *  - 若无法可靠解析来源 IP（TRUSTED_PROXY_COUNT=0，见 client-ip.ts），退化为「全部
 *    匿名请求共享一个固定占位桶」——这是刻意的保守选择：仍能限制总体速率，只是不能
 *    按来源区分；伪造 X-Forwarded-For 在无受信代理配置时完全不影响这个占位桶的判定
 *    （resolveClientIp 直接忽略该请求头，见 client-ip.ts），不存在「改个头就能绕过」
 *    的空间。
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
  const result = sharedLimitsEnabled()
    ? await consumeBucket((await import("@/server/db/prisma")).prisma, "anonymous-invite", clientIpBucketKey, 20)
    : await getAnonymousInviteRateLimiter().checkLimit(
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
