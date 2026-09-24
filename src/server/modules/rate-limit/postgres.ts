import "server-only";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";

export function bucketHash(scope: string, identity: string): string {
  return createHash("sha256").update(JSON.stringify([scope, identity])).digest("hex");
}

/** One atomic statement, database clock, bounded counters; safe across replicas. */
export async function consumeBucket(db: PrismaClient, scope: string, identity: string, max: number, windowSeconds = 60) {
  const key = bucketHash(scope, identity);
  const rows = await db.$queryRaw<Array<{ count: number; resetAfter: number }>>`
    INSERT INTO "RateLimitBucket" ("keyHash", "windowStart", count, "expiresAt")
    VALUES (${key}, statement_timestamp(), 1, statement_timestamp() + ${windowSeconds} * interval '1 second')
    ON CONFLICT ("keyHash") DO UPDATE SET
      count = CASE WHEN "RateLimitBucket"."expiresAt" <= statement_timestamp() THEN 1
        ELSE LEAST("RateLimitBucket".count + 1, ${max + 1}) END,
      "windowStart" = CASE WHEN "RateLimitBucket"."expiresAt" <= statement_timestamp()
        THEN statement_timestamp() ELSE "RateLimitBucket"."windowStart" END,
      "expiresAt" = CASE WHEN "RateLimitBucket"."expiresAt" <= statement_timestamp()
        THEN statement_timestamp() + ${windowSeconds} * interval '1 second' ELSE "RateLimitBucket"."expiresAt" END
    RETURNING count, GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("expiresAt" - statement_timestamp()))))::int AS "resetAfter"
  `;
  const row = rows[0]!;
  return { allowed: row.count <= max, remaining: Math.max(0, max - row.count), resetAfter: row.resetAfter };
}

export function sharedLimitsEnabled() {
  return process.env.APP_ENV === "production" || process.env.APP_ENV === "staging";
}
