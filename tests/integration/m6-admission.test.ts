import { afterAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { bucketHash, consumeBucket } from "@/server/modules/rate-limit/postgres";
import { acquirePostgresUpload } from "@/server/modules/attachments/postgres-gate";

const clients = [0, 1].map(() => new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL, max: 5 }) }));
const identities: string[] = [];
function identity() { const value = randomUUID(); identities.push(value); return value; }
afterAll(async () => {
  await clients[0]!.rateLimitBucket.deleteMany({ where: { keyHash: { in: identities.flatMap(id => [bucketHash("test", id), bucketHash("other", id)]) } } });
  await clients[0]!.uploadLease.deleteMany({ where: { keyHash: { in: identities.map(id => bucketHash("upload", id)) } } });
  await Promise.all(clients.map(c => c.$disconnect()));
});

test("two independent pools atomically share quota and recover expired windows", async () => {
  const id = identity();
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) => consumeBucket(clients[i % 2]!, "test", id, 10)));
  expect(results.filter(r => r.allowed)).toHaveLength(10);
  expect((await consumeBucket(clients[1]!, "other", id, 10)).allowed).toBe(true);
  await clients[0]!.rateLimitBucket.update({ where: { keyHash: bucketHash("test", id) }, data: { expiresAt: new Date(0) } });
  expect((await consumeBucket(clients[1]!, "test", id, 10)).remaining).toBe(9);
});

test("shared upload slots, rolling attempts and crashed lease recovery", async () => {
  const id = identity();
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => acquirePostgresUpload(clients[i % 2]!, id)));
  const admitted = results.filter(r => r.allowed);
  expect(admitted).toHaveLength(2);
  for (const slot of admitted) if (slot.allowed) { await slot.release(); await slot.release(); }
  for (let i = 0; i < 8; i++) {
    const slot = await acquirePostgresUpload(clients[i % 2]!, id);
    expect(slot.allowed).toBe(true);
    if (slot.allowed) await slot.release();
  }
  expect((await acquirePostgresUpload(clients[0]!, id)).allowed).toBe(false);
  await clients[0]!.uploadLease.updateMany({ where: { keyHash: bucketHash("upload", id) }, data: { startedAt: new Date(0), expiresAt: new Date(0), active: true } });
  const recovered = await acquirePostgresUpload(clients[1]!, id);
  expect(recovered.allowed).toBe(true);
  if (recovered.allowed) await recovered.release();
});
