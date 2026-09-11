/** Inspect by default; mutate only with --apply --database=<exact database name>.
 * Counts only: never read token values into application memory or logs.
 * Recognizes both legacy parameterized paths and current concrete project paths.
 */
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  if (args.some((arg) => arg !== "--apply" && !arg.startsWith("--database="))) {
    throw new Error("Unsupported argument");
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing database configuration");
  const database = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (apply && args.filter((arg) => arg === `--database=${database}`).length !== 1) {
    throw new Error("Explicit database confirmation required");
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const result = await prisma.$transaction(async (tx) => {
      if (apply) {
        const cleaned = await tx.$executeRaw`
          UPDATE "IdempotencyRecord"
          SET "responseBody" = "responseBody" || '{"token":null,"invitePath":null}'::jsonb
          WHERE "method" = 'POST'
            AND "routeKey" ~ '^POST /projects/[^/]+/invitations$'
            AND jsonb_typeof("responseBody") = 'object'
            AND (("responseBody"->'token' IS NOT NULL AND "responseBody"->'token' <> 'null'::jsonb)
              OR ("responseBody"->'invitePath' IS NOT NULL AND "responseBody"->'invitePath' <> 'null'::jsonb))
        `;
        return { mode: "apply", cleaned };
      }
      const rows = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM "IdempotencyRecord"
        WHERE "method" = 'POST'
          AND "routeKey" ~ '^POST /projects/[^/]+/invitations$'
          AND jsonb_typeof("responseBody") = 'object'
          AND (("responseBody"->'token' IS NOT NULL AND "responseBody"->'token' <> 'null'::jsonb)
            OR ("responseBody"->'invitePath' IS NOT NULL AND "responseBody"->'invitePath' <> 'null'::jsonb))
      `;
      const row = rows[0];
      if (!row) throw new Error("Missing aggregate result");
      return { mode: "dry-run", candidates: Number(row.count) };
    });
    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(() => {
  // Driver errors may contain SQL, connection strings, or user values.
  console.error("Invitation token maintenance failed; no success claimed. Check configuration, arguments, and database access.");
  process.exitCode = 1;
});
