import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const schema = await readFile("prisma/schema.prisma", "utf8");
if (/@map\(|@@map\(/.test(schema)) throw new Error("Update readiness generator for mapped database names");
const enums = new Set([...schema.matchAll(/enum (\w+)\s*\{/g)].map(m => m[1]));
const types = { String: "text", Int: "int4", BigInt: "int8", Boolean: "bool", DateTime: "timestamp", Json: "jsonb", Float: "float8", Decimal: "numeric", Bytes: "bytea" };
const native = { Text: "text", Uuid: "uuid", Char: "bpchar", VarChar: "varchar", Date: "date", Timestamptz: "timestamptz", Timestamp: "timestamp" };
const columns = [];
for (const [, table, body] of schema.matchAll(/model (\w+)\s*\{([^}]+)\}/g)) {
  for (const line of body.split("\n")) {
    const field = /^\s*(\w+)\s+(\w+)(\??)(\[\])?(.*)/.exec(line);
    if (!field) continue;
    const [, column, type, optional, array, attributes] = field;
    if (!(type in types) && !enums.has(type)) continue;
    if (array) throw new Error("Update readiness generator for scalar arrays");
    const db = /@db\.(\w+)/.exec(attributes)?.[1];
    if (db && !(db in native)) throw new Error(`Unsupported native type ${db}`);
    columns.push({ table, column, type: db ? native[db] : types[type] ?? type, nullable: optional ? "YES" : "NO" });
  }
}
const migrations = [];
for (const dir of (await readdir("prisma/migrations", { withFileTypes: true })).filter(d => d.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
  migrations.push({ name: dir.name, checksum: createHash("sha256").update(await readFile(`prisma/migrations/${dir.name}/migration.sql`)).digest("hex") });
}
await writeFile("src/generated/readiness.json", JSON.stringify({ columns, migrations }));
