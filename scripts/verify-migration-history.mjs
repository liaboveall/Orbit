import dotenv from "dotenv";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

dotenv.config({ path: [".env.local", ".env"], quiet: true });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const migrations = new Map();
for (const entry of await readdir("prisma/migrations", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const bytes = await readFile(`prisma/migrations/${entry.name}/migration.sql`);
  const lf = bytes.toString("utf8").replaceAll("\r\n", "\n");
  migrations.set(entry.name, new Set([sha(bytes), sha(lf), sha(lf.replaceAll("\n", "\r\n"))]));
}
const results = [], schemas = [];
for (const [key, database] of [["DATABASE_URL", "orbit_dev"], ["TEST_DATABASE_URL", "orbit_test"]]) {
  const url = new URL(process.env[key] ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== `/${database}`) throw new Error("Local development/test databases required");
  const db = new Client({ connectionString: url.href });
  try {
    await db.connect();
    const history = await db.query('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name');
    const unknown = history.rows.filter(row => !migrations.has(row.migration_name)).map(row => row.migration_name);
    const missing = [...migrations.keys()].filter(name => !history.rows.some(row => row.migration_name === name));
    const mismatches = history.rows.filter(row => migrations.has(row.migration_name) && !migrations.get(row.migration_name).has(row.checksum)).map(row => ({ migration: row.migration_name, appliedChecksum: row.checksum }));
    const schema = await db.query(`SELECT kind, identity, definition FROM (
      SELECT 'column' AS kind, table_name || '.' || column_name AS identity,
        json_build_array(data_type, udt_name, is_nullable, column_default, character_maximum_length)::text AS definition
        FROM information_schema.columns WHERE table_schema='public' AND table_name <> '_prisma_migrations'
      UNION ALL SELECT 'constraint', c.relname || '.' || con.conname, pg_get_constraintdef(con.oid)
        FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname <> '_prisma_migrations'
      UNION ALL SELECT 'index', tablename || '.' || indexname, indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename <> '_prisma_migrations'
      UNION ALL SELECT 'enum', t.typname || '.' || e.enumsortorder, e.enumlabel FROM pg_enum e
        JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'
    ) definitions ORDER BY kind, identity`);
    const schemaDigest = sha(JSON.stringify(schema.rows)); schemas.push(schemaDigest);
    results.push({ database, applied: history.rows.length, expected: migrations.size, unknown, missing, mismatches, schemaDigest });
  } finally { await db.end(); }
}
const ok = results.every(row => !row.unknown.length && !row.missing.length && !row.mismatches.length);
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), historyMatches: ok, developmentAndTestSchemaMatch: schemas[0] === schemas[1], results }, null, 2));
if (!ok || schemas[0] !== schemas[1]) process.exitCode = 1;
