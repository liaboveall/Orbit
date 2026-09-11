import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";

/** A bounded batch per table; concurrent jobs skip locked records. Never touches business rows. */
export async function cleanupExpiredRecords(db: PrismaClient) {
  const idempotency = await db.$executeRaw`DELETE FROM "IdempotencyRecord" WHERE id IN (
    SELECT id FROM "IdempotencyRecord" WHERE "expiresAt" < now() ORDER BY "expiresAt" LIMIT 1000 FOR UPDATE SKIP LOCKED)`;
  const buckets = await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "keyHash" IN (
    SELECT "keyHash" FROM "RateLimitBucket" WHERE "expiresAt" < now() ORDER BY "expiresAt" LIMIT 1000 FOR UPDATE SKIP LOCKED)`;
  const leases = await db.$executeRaw`DELETE FROM "UploadLease" WHERE id IN (
    SELECT id FROM "UploadLease" WHERE "expiresAt" < now() ORDER BY "expiresAt" LIMIT 1000 FOR UPDATE SKIP LOCKED)`;
  return { idempotency, buckets, leases };
}
