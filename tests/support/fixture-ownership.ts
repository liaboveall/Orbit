import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";

export const fixtureUserHash = (id: string) => createHash("sha256").update(id).digest("hex");
const ManifestSchema = z.object({ startedAt: z.string().datetime(), protectedUserHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)) });

/** Before any DELETE (including auth child rows), reject users that predate this
 * suite. Exact IDs still define deletion scope; a tag is not ownership proof. */
export async function assertFixtureUsersOwned(users: { id: string; createdAt: Date }[]) {
  const path = process.env.ORBIT_TEST_BASELINE_FILE;
  if (!path) throw new Error("Fixture cleanup requires the suite ownership manifest");
  const manifest = ManifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const protectedIds = new Set(manifest.protectedUserHashes);
  const startedAt = Date.parse(manifest.startedAt);
  if (users.some(user => protectedIds.has(fixtureUserHash(user.id)) || user.createdAt.getTime() < startedAt)) {
    throw new Error("Fixture cleanup refused: target includes a pre-existing user");
  }
}
