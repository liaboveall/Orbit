import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";

/** A bounded batch per table; concurrent jobs skip locked records. Never touches business rows. */
export async function cleanupExpiredIdempotency(db: PrismaClient) {
  return db.$executeRaw`DELETE FROM "IdempotencyRecord" WHERE id IN (
    SELECT id FROM "IdempotencyRecord" WHERE "expiresAt" < now() ORDER BY "expiresAt" LIMIT 1000 FOR UPDATE SKIP LOCKED)`;
}
export async function cleanupExpiredRecords(db: PrismaClient) {
  const idempotency = await cleanupExpiredIdempotency(db);
  const buckets = await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "keyHash" IN (
    SELECT "keyHash" FROM "RateLimitBucket" WHERE "expiresAt" < now() ORDER BY "expiresAt" LIMIT 1000 FOR UPDATE SKIP LOCKED)`;
  const leases = await db.$executeRaw`DELETE FROM "UploadLease" WHERE id IN (
    SELECT id FROM "UploadLease" WHERE "expiresAt" < now() ORDER BY "expiresAt" LIMIT 1000 FOR UPDATE SKIP LOCKED)`;
  return { idempotency, buckets, leases };
}

/** Drain several small transactions; cap work so maintenance cannot monopolize micro. */
export async function drainExpiredRecords(db: PrismaClient) {
  const totals = { idempotency: 0, buckets: 0, leases: 0, batches: 0, saturated: false };
  for (let batch = 0; batch < 10; batch++) {
    const result = await cleanupExpiredRecords(db);
    totals.idempotency += result.idempotency;
    totals.buckets += result.buckets;
    totals.leases += result.leases;
    totals.batches++;
    totals.saturated = Object.values(result).some((count) => count === 1000);
    if (!totals.saturated) break;
  }
  return totals;
}
