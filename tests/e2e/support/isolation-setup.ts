import pg from "pg";
import {createHash} from "node:crypto";
import {withTestDb} from "./db";

async function fingerprint(connectionString: string): Promise<string> {
  const url = new URL(connectionString);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolation check requires local databases");
  const client = new pg.Client({connectionString});
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables = await client.query<{tablename: string}>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    const digest = createHash("sha256");
    for (const {tablename} of tables.rows) {
      const quoted = '"' + tablename.replaceAll('"', '""') + '"';
      // Hash in SQL: never expose credentials, tokens or user content to logs/files.
      const rows = await client.query<{hash: string}>(`SELECT md5(row_to_json(t)::text) AS hash FROM ${quoted} t ORDER BY hash`);
      digest.update(tablename + JSON.stringify(rows.rows));
    }
    await client.query("COMMIT");
    return digest.digest("hex");
  } finally {await client.end();}
}
export default async function setup() {
  await withTestDb(async () => undefined);
  const dev = process.env.DATABASE_URL!, test = process.env.TEST_DATABASE_URL!;
  const beforeDev = await fingerprint(dev), beforeTest = await fingerprint(test);
  return async () => {
    if (await fingerprint(dev) !== beforeDev) throw new Error("Development database contents changed during browser tests");
    if (await fingerprint(test) !== beforeTest) throw new Error("Test database did not return to its pre-run contents; inspect fixture cleanup");
    console.log("[isolation] Development and test database content fingerprints unchanged after fixture cleanup.");
  };
}
