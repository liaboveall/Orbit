import "server-only";
import { prisma } from "@/server/db/prisma";
import { lockProjectRow, withTransaction } from "@/server/db/tx";
import { deleteObject } from "@/server/modules/storage/client";

/** Each candidate is rechecked under its project lock. Physical deletion is idempotent and retryable. */
export async function cleanupOrphanAttachmentsLocked(
  options: { now?: Date; projectId?: string; limit?: number } = {},
) {
  const cutoff = new Date((options.now?.getTime() ?? Date.now()) - 3600000);
  // Let a cancelled in-flight PUT settle before clearing its durable cleanup marker.
  // HTTP uploads have a 120-second deadline; retain another minute of margin.
  const settled = new Date((options.now?.getTime() ?? Date.now()) - 180000);
  const candidates = await prisma.attachment.findMany({
    where: {
      projectId: options.projectId,
      OR: [
        { state: "UPLOADING", updatedAt: { lt: cutoff } },
        {
          cleanupPending: true,
          state: { in: ["FAILED", "DELETED"] },
          updatedAt: { lt: settled },
        },
      ],
    },
    select: { id: true, projectId: true },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: Math.min(options.limit ?? 100, 100),
  });
  let cleanedCount = 0,
    failedCount = 0,
    releasedBytes = 0n;
  for (const candidate of candidates) {
    const pending = await withTransaction(async (tx) => {
      await lockProjectRow(tx, candidate.projectId);
      const row = await tx.attachment.findUnique({
        where: { id: candidate.id },
      });
      if (!row) return null;
      if (row.state === "UPLOADING" && row.updatedAt < cutoff) {
        await tx.project.update({
          where: { id: row.projectId },
          data: { reservedBytes: { decrement: row.declaredSizeBytes } },
        });
        const failed = await tx.attachment.update({
          where: { id: row.id },
          data: {
            state: "FAILED",
            cleanupPending: true,
            errorCode: "UPLOAD_TIMEOUT",
          },
        });
        return { row: failed, released: row.declaredSizeBytes };
      }
      return row.cleanupPending &&
        row.updatedAt < settled &&
        (row.state === "FAILED" || row.state === "DELETED")
        ? { row, released: 0n }
        : null;
    });
    if (!pending) continue;
    releasedBytes += pending.released;
    try {
      await deleteObject(pending.row.objectKey);
      await prisma.attachment.updateMany({
        where: {
          id: pending.row.id,
          updatedAt: pending.row.updatedAt,
          state: { in: ["FAILED", "DELETED"] },
          cleanupPending: true,
        },
        data: { cleanupPending: false },
      });
      cleanedCount++;
    } catch {
      failedCount++;
    }
  }
  return { cleanedCount, failedCount, releasedBytes };
}
export const cleanupOrphanAttachments = cleanupOrphanAttachmentsLocked;
