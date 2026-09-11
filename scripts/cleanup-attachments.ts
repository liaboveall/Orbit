import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
const { cleanupOrphanAttachmentsLocked } = await import(
  "../src/server/modules/attachments/cleanup"
);
const { prisma } = await import("../src/server/db/prisma");
try {
  const result = await cleanupOrphanAttachmentsLocked();
  console.log(
    JSON.stringify({
      ...result,
      releasedBytes: result.releasedBytes.toString(),
    }),
  );
  if (result.failedCount) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
