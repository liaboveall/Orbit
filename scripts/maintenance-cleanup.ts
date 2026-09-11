import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
const { prisma } = await import("../src/server/db/prisma");
try {
  const { cleanupExpiredRecords } = await import("../src/server/modules/maintenance/cleanup");
  const { cleanupOrphanAttachmentsLocked } = await import("../src/server/modules/attachments/cleanup");
  const records = await cleanupExpiredRecords(prisma);
  const attachments = await cleanupOrphanAttachmentsLocked();
  console.log(JSON.stringify({ event: "maintenance_complete", ...records, ...attachments, releasedBytes: attachments.releasedBytes.toString() }));
  if (attachments.failedCount) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ event: "maintenance_failed" }));
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
