import { test, expect } from "vitest";
import { mkdtemp, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertFixtureUsersOwned, fixtureUserHash } from "../support/fixture-ownership";

test("清理门禁拒绝历史 ID、早于本轮的用户与缺失清单，放行本轮精确 ID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orbit-ownership-test-"));
  const path = join(directory, "manifest.json");
  const prior = process.env.ORBIT_TEST_BASELINE_FILE;
  const now = new Date();
  try {
    process.env.ORBIT_TEST_BASELINE_FILE = path;
    await writeFile(path, JSON.stringify({ startedAt: now.toISOString(), protectedUserHashes: [fixtureUserHash("historical-synthetic-user")] }));
    await expect(assertFixtureUsersOwned([{ id: "historical-synthetic-user", createdAt: now }])).rejects.toThrow("pre-existing");
    await expect(assertFixtureUsersOwned([{ id: "other-old-user", createdAt: new Date(0) }])).rejects.toThrow("pre-existing");
    await expect(assertFixtureUsersOwned([{ id: "current-unique-user", createdAt: now }])).resolves.toBeUndefined();
    delete process.env.ORBIT_TEST_BASELINE_FILE;
    await expect(assertFixtureUsersOwned([{ id: "current-unique-user", createdAt: now }])).rejects.toThrow("manifest");
  } finally {
    if (prior === undefined) delete process.env.ORBIT_TEST_BASELINE_FILE;
    else process.env.ORBIT_TEST_BASELINE_FILE = prior;
    await rm(path, { force: true });
    await rmdir(directory);
  }
});
