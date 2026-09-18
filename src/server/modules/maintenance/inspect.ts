import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";

/** Single-statement snapshot, including attachments on soft-deleted tasks. Never repairs accounting. */
export async function inspectStorageAccounting(db: PrismaClient, projectId: string | null = null) {
  const rows = await db.$queryRaw<Array<{ checked: bigint; mismatches: bigint }>>`
    WITH totals AS (
      SELECT p.id, p."reservedBytes", p."usedBytes",
        COALESCE(SUM(a."declaredSizeBytes") FILTER (WHERE a.state = 'UPLOADING' AND a."deletedAt" IS NULL), 0) AS reserved,
        COALESCE(SUM(a."sizeBytes") FILTER (WHERE a.state = 'READY' AND a."deletedAt" IS NULL), 0) AS used
      FROM "Project" p LEFT JOIN "Attachment" a ON a."projectId" = p.id
      WHERE (${projectId}::uuid IS NULL OR p.id = ${projectId}::uuid)
      GROUP BY p.id
    ) SELECT count(*) AS checked,
        count(*) FILTER (WHERE "reservedBytes" <> reserved OR "usedBytes" <> used) AS mismatches FROM totals`;
  return { checked: Number(rows[0]?.checked ?? 0), mismatches: Number(rows[0]?.mismatches ?? 0) };
}

export async function previewMaintenance(db: PrismaClient) {
  const [idempotency, buckets, leases, attachments] = await Promise.all([
    db.idempotencyRecord.count({ where: { expiresAt: { lt: new Date() } } }),
    db.rateLimitBucket.count({ where: { expiresAt: { lt: new Date() } } }),
    db.uploadLease.count({ where: { expiresAt: { lt: new Date() } } }),
    db.attachment.count({ where: { OR: [
      { state: "UPLOADING", updatedAt: { lt: new Date(Date.now() - 3600000) } },
      { cleanupPending: true, state: { in: ["FAILED", "DELETED"] }, updatedAt: { lt: new Date(Date.now() - 180000) } },
    ] } }),
  ]);
  return { idempotency, buckets, leases, attachments };
}
