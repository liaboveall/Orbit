import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
const { prisma } = await import("../src/server/db/prisma");
try {
  const { drainExpiredRecords } = await import("../src/server/modules/maintenance/cleanup");
  const { cleanupOrphanAttachmentsLocked } = await import("../src/server/modules/attachments/cleanup");
  const records = await drainExpiredRecords(prisma);
  const attachments = await cleanupOrphanAttachmentsLocked();
  console.log(JSON.stringify({ event: "maintenance_complete", ...records, ...attachments, releasedBytes: attachments.releasedBytes.toString() }));
  if (attachments.failedCount || records.saturated) process.exitCode = 1;
} catch (error) {
  // F41：记录安全的错误类别（error.name）而非原始 message（可能含连接串细节）。
  console.error(JSON.stringify({
    event: "maintenance_failed",
    errorClass: error instanceof Error ? error.name : "unknown",
  }));
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
