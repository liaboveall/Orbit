import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { cleanupTestEmails, withTestDb } from "./support/db";
import { fixtureUserHash } from "../support/fixture-ownership";

test("清理历史夹具在删除认证/幂等关联之前被拒绝", async () => {
  const manifest = JSON.parse(await readFile(process.env.ORBIT_TEST_BASELINE_FILE!, "utf8")) as { protectedUserHashes: string[] };
  const users = await withTestDb(async client => (await client.query<{ id: string; email: string }>('SELECT id, email FROM "User"')).rows);
  const existing = users.find(user => manifest.protectedUserHashes.includes(fixtureUserHash(user.id)));
  // Empty fresh CI has no historic users. Still exercise fail-closed handling:
  // no ownership manifest may never authorize cleanup, including a stale email.
  if (existing) {
    await expect(cleanupTestEmails([existing.email])).rejects.toThrow("pre-existing user");
  } else {
    const path = process.env.ORBIT_TEST_BASELINE_FILE;
    try {
      delete process.env.ORBIT_TEST_BASELINE_FILE;
      await expect(cleanupTestEmails(["never-created@orbit.test"])).rejects.toThrow("manifest");
    } finally { process.env.ORBIT_TEST_BASELINE_FILE = path; }
  }
});
