#!/usr/bin/env tsx
/**
 * Script to check for inconsistent Invitation records (R07 security fix).
 * 
 * SECURITY ISSUE: This script ONLY checks and REPORTS inconsistent records.
 * It does NOT automatically delete or modify any data.
 * 
 * Consistency rule: acceptedAt and acceptedById must be both NULL or both non-NULL.
 * 
 * CRITICAL SAFETY FEATURES:
 * 1. Does NOT auto-delete any records
 * 2. Logs all problematic records for manual review
 * 3. Exits with error code if inconsistencies found
 * 4. Requires manual decision before any cleanup action
 * 
 * USAGE:
 * 1. First run to check for issues: tsx scripts/cleanup-invitation-constraints.ts
 * 2. If inconsistencies found, manually investigate each record
 * 3. Follow docs/08-ENVIRONMENT-AND-DEPLOYMENT.md; investigate each inconsistency before planning a repair
 * 
 * IMPORTANT: DO NOT trust this to safely clean data - it's a DANGEROUS operation!
 * Review output and decide manually how to handle each inconsistent record.
 * 
 * See also: scripts/cleanup-invitation-constraints-SAFE.md (alternative verification only)
 */

import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// Prisma 7 不再自动加载 .env（见 prisma.config.ts）；约定先 .env.local 再 .env 回退。
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🔍 Checking for inconsistent Invitation records (R07 security check)...\n");
  
  try {
    // Query for INVALID records ONLY using EXPLICIT XOR logic
    // Inconsistent = (acceptedAt IS NOT NULL AND acceptedById IS NULL)
    //              OR (acceptedAt IS NULL AND acceptedById IS NOT NULL)
    const inconsistentRecords = await prisma.invitation.findMany({
      where: {
        OR: [
          { 
            acceptedAt: { not: null }, 
            acceptedById: null 
          },
          { 
            acceptedAt: null, 
            acceptedById: { not: null } 
          }
        ]
      }
    });
    
    const count = inconsistentRecords.length;

    if (count === 0) {
      console.log("✅ No inconsistent Invitation records found.");
      console.log("🛡️  Database state is consistent with R07 constraint requirements.");
      console.log("\n💡 Ready to apply CHECK constraint via migration.\n");
      await prisma.$disconnect();
      process.exit(0);
    }

    console.log(`⚠️  Found ${count} INCONSISTENT record(s):\n`);
    
    // Log detailed information for each problematic record
    for (const record of inconsistentRecords) {
      console.log(`─"───────────────────────────────`);
      console.log(`ID: ${record.id}`);
      console.log(`Token Hash: ${record.tokenHash.slice(0, 8)}...`);
      console.log(`Project ID: ${record.projectId}`);
      
      if (record.acceptedAt && !record.acceptedById) {
        console.log(`⚠️  PROBLEM: Has acceptance timestamp but NO assigned user!`);
        console.log(`   acceptedAt: ${record.acceptedAt}`);
        console.log(`   acceptedById: NULL (should not be NULL)`);
        console.log(`   🔴 This allows reusing invitation without actual user assignment!`);
      } else if (!record.acceptedAt && record.acceptedById) {
        console.log(`⚠️  PROBLEM: Has assigned user but NO acceptance timestamp!`);
        console.log(`   acceptedAt: NULL (should not be NULL)`);
        console.log(`   acceptedById: ${record.acceptedById}`);
        console.log(`   🔴 User assigned but invitation never formally accepted!`);
      }
      
      console.log(``);
    }

    console.log("═".repeat(45));
    console.log("⚠️  CRITICAL WARNING: INCONSISTENT DATA DETECTED!\n");
    console.log("These records should NOT exist based on application business logic.");
    console.log("They may indicate deeper bugs in invitation acceptance flow.\n");
    console.log("══════════════════════════════════════════════");
    console.log("");
    console.log("⛔ ACTION REQUIRED:");
    console.log("DO NOT proceed with migration until these issues are resolved.");
    console.log("");
    console.log("Manual review needed:");
    console.log("1. Check the source of each inconsistent record");
    console.log("2. Identify which field is incorrect (if any)");
    console.log("3. Manually correct each record via direct SQL UPDATE/DELETE");
    console.log("4. Re-run this script to verify zero issues");
    console.log("");
    console.log("Maintenance boundaries (prepare a record-specific repair plan):");
    console.log("  docs/08-ENVIRONMENT-AND-DEPLOYMENT.md\n");
    
    await prisma.$disconnect();
    process.exit(1); // Exit with error to prevent automatic continuation
    
  } catch (error) {
    console.error("\n❌ Verification failed:", error instanceof Error ? error.message : String(error));
    console.error("\n⚠️  Do NOT proceed with migration until this error is resolved.\n");
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
