import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { bucketHash } from "@/server/modules/rate-limit/postgres";

/** Lease outlives the 120-second multipart deadline; crashed workers recover in 3 minutes. */
export async function acquirePostgresUpload(db: PrismaClient, userId: string) {
  const key = bucketHash("upload", userId);
  const admission = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const [usage] = await tx.$queryRaw<Array<{ attempts: number; active: number; retry: number }>>`
      SELECT count(*) FILTER (WHERE "startedAt" > statement_timestamp() - interval '1 minute')::int AS attempts,
        count(*) FILTER (WHERE active AND "expiresAt" > statement_timestamp())::int AS active,
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM (min("startedAt") FILTER (WHERE "startedAt" > statement_timestamp() - interval '1 minute') + interval '1 minute' - statement_timestamp()))))::int AS retry
      FROM "UploadLease" WHERE "keyHash" = ${key} AND "expiresAt" > statement_timestamp()
    `;
    if (usage!.attempts >= 10) return { allowed: false as const, retryAfter: usage!.retry };
    if (usage!.active >= 2) return { allowed: false as const, retryAfter: 1 };
    const [row] = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "UploadLease" ("keyHash", "expiresAt") VALUES (${key}, statement_timestamp() + interval '3 minutes') RETURNING id
    `;
    return { allowed: true as const, id: row!.id };
  });
  if (!admission.allowed) return admission;
  return { allowed: true as const, release: async () => {
    await db.uploadLease.updateMany({ where: { id: admission.id, active: true }, data: { active: false } });
  } };
}
