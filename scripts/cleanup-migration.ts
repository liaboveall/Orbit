#!/usr/bin/env tsx
/**
 * Cleanup script for failed migration 20260910001346
 * 
 * This migration failed to apply due to PostgreSQL not supporting XOR syntax.
 * This script removes the failed migration record from _prisma_migrations
 * and ensures the database is clean for applying the correct CHECK constraint.
 */

import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// Prisma 7 不再自动加载 .env（见 prisma.config.ts）；约定先 .env.local 再 .env 回退。
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  console.log("🧹 Cleaning up failed migration 20260910001346...");

  try {
    // Remove the failed migration record
    const deleted = await prisma.$executeRaw`
      DELETE FROM _prisma_migrations 
      WHERE migration_name = '20260910001346_add_invitation_accepted_constraint'
    `;
    
    console.log(`✅ Removed ${deleted} record(s) from _prisma_migrations`);

    // Drop any trigger that might have been partially created
    await prisma.$executeRaw`
      DROP TRIGGER IF EXISTS trg_check_invitation_accepted_fields ON "Invitation"
    `;
    console.log("✅ Dropped trigger (if it existed)");

    await prisma.$executeRaw`
      DROP FUNCTION IF EXISTS check_invitation_accepted_fields() CASCADE
    `;
    console.log("✅ Dropped function (if it existed)");

    // Verify cleanup
    const remaining = await prisma.$queryRaw`
      SELECT COUNT(*) as count 
      FROM _prisma_migrations 
      WHERE migration_name = '20260910001346_add_invitation_accepted_constraint'
    `;
    
    console.log("✅ Verification - remaining records:", remaining);

    console.log("\n🎉 Database cleanup complete!");
    console.log("📝 You can now apply the correct migration: 20260910001347_add_invitation_accepted_constraint");

  } catch (error) {
    console.error("❌ Cleanup failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
