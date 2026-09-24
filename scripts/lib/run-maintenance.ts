import dotenv from "dotenv";
import { maintenanceIntent, MaintenancePreflightError, type MaintenanceScope } from "./maintenance-target";

export async function runMaintenance(scope: MaintenanceScope) {
  dotenv.config({ path: [".env.local", ".env"], quiet: true });
  try {
    const intent = maintenanceIntent(scope, process.argv.slice(2), process.env);
    const { prisma } = await import("../../src/server/db/prisma");
    try {
      const { previewMaintenance, inspectStorageAccounting } = await import("../../src/server/modules/maintenance/inspect");
      const candidates = await previewMaintenance(prisma);
      console.log(JSON.stringify({ event: "maintenance_preview", ...intent, candidates }));
      if (intent.execute) {
        const { drainExpiredRecords, cleanupExpiredIdempotency } = await import("../../src/server/modules/maintenance/cleanup");
        const { cleanupOrphanAttachmentsLocked } = await import("../../src/server/modules/attachments/cleanup");
        if (scope === "all") {
          const records = await drainExpiredRecords(prisma);
          console.log(JSON.stringify({ event: "records_cleaned", ...records }));
          if (records.saturated) process.exitCode = 1;
        }
        if (scope === "idempotency") {
          // Bounded work even when new expired records keep arriving.
          let deleted = 0, saturated = false;
          for (let batch = 0; batch < 10; batch++) {
            const count = await cleanupExpiredIdempotency(prisma);
            deleted += count; saturated = count === 1000;
            if (!saturated) break;
          }
          console.log(JSON.stringify({ event: "idempotency_cleaned", deleted, saturated }));
          if (saturated) process.exitCode = 1;
        }
        if (scope !== "idempotency") {
          const result = await cleanupOrphanAttachmentsLocked();
          console.log(JSON.stringify({ event: "attachments_cleaned", ...result, releasedBytes: result.releasedBytes.toString() }));
          if (result.failedCount) process.exitCode = 1;
        }
      }
      if (scope !== "idempotency") {
        const accounting = await inspectStorageAccounting(prisma);
        console.log(JSON.stringify({ event: "storage_accounting", ...accounting }));
        if (accounting.mismatches) process.exitCode = 1;
      }
    } finally { await prisma.$disconnect(); }
  } catch (error) {
    console.error(JSON.stringify({ event: "maintenance_failed", errorClass: error instanceof Error ? error.name : "unknown",
      ...(error instanceof MaintenancePreflightError ? { message: error.message } : {}),
    }));
    process.exitCode = 1;
  }
}
