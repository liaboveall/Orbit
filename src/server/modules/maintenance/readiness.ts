import "server-only";
import { prisma } from "@/server/db/prisma";

/** Database readiness only; optional mail/storage outages must not take the whole app offline. */
export async function checkReadiness(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "RateLimitBucket" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
}
