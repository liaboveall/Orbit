import { it, expect } from "vitest";
import { Client } from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { checkReadiness } from "@/server/modules/maintenance/readiness";

it("rejects incomplete schema, failed migrations and missing business columns in a disposable real database", async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/orbit_test") throw new Error("Local test target required");
  url.hostname = "127.0.0.1";
  const admin = new Client({ connectionString: url.href });
  const name = `orbit_ready_${randomUUID().replaceAll("-", "")}_test`;
  await admin.connect();
  let db: PrismaClient | undefined;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    url.pathname = `/${name}`;
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.href }) });
    expect(await checkReadiness(db)).toBe(false);
    await db.$executeRaw`CREATE TABLE "RateLimitBucket" (dummy integer)`;
    expect(await checkReadiness(db)).toBe(false);
    await db.$executeRaw`DROP TABLE "RateLimitBucket"`;
    const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.href }, stdio: "pipe", windowsHide: true });
    expect(migration.status, "Disposable migrate deploy exit status").toBe(0);
    expect(await checkReadiness(db)).toBe(true);
    await db.$executeRaw`INSERT INTO "_prisma_migrations" (id, checksum, migration_name) VALUES ('synthetic-failure', 'test', 'synthetic_failed_migration')`;
    expect(await checkReadiness(db)).toBe(false);
    await db.$executeRaw`DELETE FROM "_prisma_migrations" WHERE id='synthetic-failure'`;
    await db.$executeRaw`ALTER TABLE "Task" DROP COLUMN description`;
    expect(await checkReadiness(db)).toBe(false);
  } finally {
    await db?.$disconnect();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
}, 30000);
