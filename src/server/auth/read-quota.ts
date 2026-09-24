import "server-only";
import { consumeBucket, sharedLimitsEnabled } from "@/server/modules/rate-limit/postgres";

/** 每用户每分钟读取额度：API GET/HEAD 与完整页面请求共用同一个 PostgreSQL 桶（docs/03 §8）。 */
export const READ_REQUESTS_PER_MINUTE = 300;

export type ReadAdmission = { allowed: true } | { allowed: false; retryAfter: number };

/** 消费一次读取额度；development/test 未启用共享限流时直接放行。 */
export async function consumeReadQuota(userId: string): Promise<ReadAdmission> {
  if (!sharedLimitsEnabled()) return { allowed: true };
  const { prisma } = await import("@/server/db/prisma");
  const result = await consumeBucket(prisma, "read", userId, READ_REQUESTS_PER_MINUTE);
  return result.allowed ? { allowed: true } : { allowed: false, retryAfter: result.resetAfter };
}
