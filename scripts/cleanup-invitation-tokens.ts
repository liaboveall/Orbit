/**
 * Cleanup script to remove leaked tokens from IdempotencyRecord table.
 * 
 * Security Issue (R01): Previous implementation stored plaintext invitation tokens 
 * and invite paths in the responseBody JSONB column of IdempotencyRecords.
 * 
 * This script:
 * 1. Queries all IdempotencyRecords where responseBody contains leaked fields
 * 2. Strips token + invitePath from stored JSONB data
 * 3. Updates records if changed (keeps audit trail intact)
 * 4. Logs count of cleaned vs unchanged records
 * 
 * IMPORTANT: Must run BEFORE applying new migrations that might create new leaks!
 * 
 * Usage: tsx scripts/cleanup-invitation-tokens.ts
 */

import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// Prisma 7 不再自动加载 .env（见 prisma.config.ts）；约定先 .env.local 再 .env 回退。
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function cleanupInvitationTokens(): Promise<void> {
  console.log("🔍 Scanning IdempotencyRecords for leaked tokens...");
  
  // Get all idempotency records related to invitation creation
  const records = await prisma.idempotencyRecord.findMany({
    where: {
      routeKey: "POST /projects/:projectId/invitations",
    },
    select: {
      id: true,
      responseStatus: true,
      responseBody: true,
      createdAt: true,
    },
  });

  let cleanedCount = 0;
  let unchangedCount = 0;

  for (const record of records) {
    // Check if response status is 201 or 200 (created or replayed)
    if (record.responseStatus !== 201 && record.responseStatus !== 200) {
      continue;
    }

    try {
      const body = typeof record.responseBody === "string"
        ? JSON.parse(record.responseBody)
        : record.responseBody;

      // Cast to any to check structure (we know it's CreatedInvitationDTO shape)
      const typedBody = body as Record<string, unknown>;

      // Check if this has leaked token/invitePath fields
      const hasLeakedFields = 
        typedBody.token !== null && typedBody.invitePath !== null &&
        (typedBody.token !== undefined || typedBody.invitePath !== undefined);

      if (!hasLeakedFields) {
        unchangedCount++;
        continue;
      }

      // Sanitize: ensure both fields are explicitly null
      const sanitizedBody = {
        ...typedBody,
        token: null,
        invitePath: null,
      };

      // Update record
      await prisma.idempotencyRecord.update({
        where: { id: record.id },
        data: { responseBody: sanitizedBody },
      });

      console.log(`✅ Cleaned record ${record.id.substring(0, 8)} (${record.createdAt.toISOString()})`);
      cleanedCount++;
    } catch (err) {
      // If JSON parse fails or update errors, log but continue
      console.warn(`⚠️  Failed to process record ${record.id}:`, err instanceof Error ? err.message : String(err));
      unchangedCount++;
    }
  }

  console.log("\n📊 Summary:");
  console.log(`   ✅ Cleaned:  ${cleanedCount} record(s)`);
  console.log(`   ⏭️  Unchanged: ${unchangedCount} record(s)`);
  console.log(`   📄 Total scanned: ${records.length} record(s)`);

  if (cleanedCount > 0) {
    console.log("\n✨ Tokens successfully removed from database!");
  } else if (records.length === 0) {
    console.log("\n🔒 No invitation records found - nothing to clean.");
  } else {
    console.log("\n🛡️  All records already secure (no leaked tokens detected).");
  }

  await prisma.$disconnect();
}

// Run cleanup
cleanupInvitationTokens()
  .catch((error) => {
    console.error("❌ Cleanup failed:", error);
    process.exit(1);
  })
  .finally(() => {
    console.log("\n✅ Cleanup complete.");
  });
