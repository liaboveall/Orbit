import "server-only";
import { prisma } from "@/server/db/prisma";
import expected from "@/generated/readiness.json";

/** Database readiness only; optional mail/storage outages must not take the whole app offline. */
export async function checkReadiness(db: Pick<typeof prisma, "$queryRaw"> = prisma): Promise<boolean> {
  try {
    const migrations = await db.$queryRaw<{ name: string; checksum: string; finished: boolean; failed: boolean }[]>`
      SELECT migration_name AS name, checksum, finished_at IS NOT NULL AS finished,
        (finished_at IS NULL AND rolled_back_at IS NULL) AS failed FROM "_prisma_migrations"`;
    if (migrations.some(m => m.failed) || !expected.migrations.every(e => migrations.some(m =>
      m.name === e.name && m.checksum === e.checksum && m.finished))) return false;
    const columns = await db.$queryRaw<{ table: string; column: string; type: string; nullable: string }[]>`
      SELECT table_name AS "table", column_name AS "column", udt_name AS type, is_nullable AS nullable
      FROM information_schema.columns WHERE table_schema = current_schema()`;
    const actual = new Map(columns.map(c => [`${c.table}.${c.column}`, c]));
    return expected.columns.every(e => {
      const c = actual.get(`${e.table}.${e.column}`);
      return c?.type === e.type && c.nullable === e.nullable;
    });
  } catch {
    return false;
  }
}
