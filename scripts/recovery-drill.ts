import dotenv from "dotenv";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { cleanupExpiredRecords, drainExpiredRecords } from "../src/server/modules/maintenance/cleanup";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
const target = new URL(process.env.TEST_DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("/orbit_test")) throw new Error("Local orbit_test configuration required");
const tag = randomUUID().replaceAll("-", "");
const names = [`orbit_recovery_test_${tag}_source`, `orbit_recovery_test_${tag}_restored`];
const created: string[] = [];
const keys = [`recovery-test/${tag}/sample.txt`, `recovery-test/${tag}/restored.txt`];
const bucket = process.env.STORAGE_BUCKET!;
const storage = new S3Client({ endpoint: process.env.STORAGE_ENDPOINT, region: process.env.STORAGE_REGION, forcePathStyle: true, credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY! } });
const clients: PrismaClient[] = [];
function docker(args: string[], input?: Buffer) {
  const result = spawnSync("docker", ["exec", ...(input ? ["-i"] : []), "orbit-postgres", ...args], { input, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("Recovery database operation failed");
  return result.stdout;
}
const start = performance.now();
// F41：分阶段记录失败位置；只输出错误类别，不输出可能含凭证的原始 message。
let stage = "init";
try {
  stage = "prepare";
  for (const name of names) {
    docker(["createdb", "-U", "orbit", name]); created.push(name);
    const url = new URL(target); url.pathname = `/${name}`;
    clients.push(new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) }));
  }
  const sourceUrl = new URL(target); sourceUrl.pathname = `/${names[0]}`;
  const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: sourceUrl.toString() }, stdio: "pipe" });
  if (migration.status !== 0) throw new Error("Recovery source migration failed");
  const db = clients[0]!;
  stage = "maintenance-dry-run";
  await db.rateLimitBucket.createMany({ data: [
    { keyHash: "a".repeat(64), windowStart: new Date(0), count: 1, expiresAt: new Date(0) },
    { keyHash: "b".repeat(64), windowStart: new Date(), count: 1, expiresAt: new Date(Date.now() + 3600000) },
  ] });
  await db.uploadLease.create({ data: { keyHash: "a".repeat(64), expiresAt: new Date(0) } });
  const authUser = await db.user.create({ data: { email: `maintenance-${tag}@recovery.orbit.test`, name: "维护演练", emailVerified: true } });
  await db.session.createMany({ data: [
    { token: `expired-${tag}`, userId: authUser.id, expiresAt: new Date(0) },
    { token: `live-${tag}`, userId: authUser.id, expiresAt: new Date(Date.now() + 3600000) },
  ] });
  await db.verification.createMany({ data: [
    { identifier: `reset-password:expired-${tag}`, value: authUser.id, expiresAt: new Date(0) },
    { identifier: `reset-password:live-${tag}`, value: authUser.id, expiresAt: new Date(Date.now() + 3600000) },
  ] });
  const maintenance = await cleanupExpiredRecords(db);
  const repeated = await cleanupExpiredRecords(db);
  if (maintenance.buckets !== 1 || maintenance.leases !== 1 || repeated.buckets !== 0 || repeated.leases !== 0 || await db.rateLimitBucket.count() !== 1) throw new Error("Maintenance isolation or idempotency failed");
  if (maintenance.sessions !== 1 || maintenance.verifications !== 1 || repeated.sessions !== 0 || repeated.verifications !== 0
    || await db.session.count() !== 1 || await db.verification.count() !== 1) throw new Error("Expired auth record cleanup failed");
  await db.rateLimitBucket.createMany({ data: Array.from({ length: 1001 }, (_, i) => ({
    keyHash: createHash("sha256").update(`drain-${tag}-${i}`).digest("hex"),
    windowStart: new Date(0), expiresAt: new Date(0), count: 1,
  })) });
  const drained = await drainExpiredRecords(db);
  if (drained.buckets !== 1001 || drained.batches !== 2 || drained.saturated || await db.rateLimitBucket.count() !== 1) throw new Error("Maintenance batch drain failed");
  stage = "fixture-seed";
  const owner = await db.user.create({ data: { email: `${tag}@recovery.orbit.test`, name: "恢复演练", emailVerified: true } });
  const project = await db.project.create({ data: { ownerId: owner.id, key: "RESTORE", name: "恢复演练", color: "BLUE" } });
  await db.projectMember.create({ data: { projectId: project.id, userId: owner.id } });
  const task = await db.task.create({ data: { projectId: project.id, creatorId: owner.id, number: 1, title: "验证恢复", position: 1024n, version: 3 } });
  await db.comment.create({ data: { taskId: task.id, authorId: owner.id, body: "合成恢复样例" } });
  await db.activityLog.create({ data: { projectId: project.id, actorId: owner.id, entityType: "TASK", entityId: task.id, action: "TASK_CREATED" } });
  const bytes = Buffer.from("Orbit synthetic recovery sample\n");
  const digest = createHash("sha256").update(bytes).digest("hex");
  stage = "storage-upload";
  await storage.send(new PutObjectCommand({ Bucket: bucket, Key: keys[0], Body: bytes, ContentType: "text/plain" }));
  await db.attachment.create({ data: { projectId: project.id, taskId: task.id, uploaderId: owner.id, clientUploadId: randomUUID(), claimedSha256: digest, sha256: digest, originalName: "sample.txt", objectKey: keys[0]!, mimeType: "text/plain", declaredSizeBytes: BigInt(bytes.length), sizeBytes: BigInt(bytes.length), state: "READY" } });
  await db.project.update({ where: { id: project.id }, data: { usedBytes: BigInt(bytes.length) } });
  const dump = docker(["pg_dump", "-U", "orbit", "-Fc", names[0]!]);
  const object = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: keys[0] }));
  const backup = await object.Body!.transformToByteArray();
  const restoreStart = performance.now();
  docker(["pg_restore", "-U", "orbit", "--exit-on-error", "--no-owner", "-d", names[1]!], dump);
  await storage.send(new PutObjectCommand({ Bucket: bucket, Key: keys[1], Body: backup }));
  const restored = clients[1]!;
  // Isolated restore prefix mapping, never overwrites the source object.
  await restored.attachment.updateMany({ where: { projectId: project.id }, data: { objectKey: keys[1] } });
  const file = await restored.attachment.findFirstOrThrow({ where: { taskId: task.id } });
  const download = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: file.objectKey }));
  const actual = createHash("sha256").update(await download.Body!.transformToByteArray()).digest("hex");
  if (actual !== digest || (await restored.task.findUniqueOrThrow({ where: { id: task.id } })).version !== 3 || await restored.projectMember.count() !== 1 || await restored.comment.count() !== 1 || await restored.activityLog.count() !== 1) throw new Error("Recovery verification failed");
  const report = { environment: "local Docker PostgreSQL + S3-compatible storage (SeaweedFS); synthetic isolated databases", restoredMembers: 1, taskVersion: 3, comments: 1, activities: 1, attachmentSha256Verified: true, restoreSeconds: (performance.now() - restoreStart) / 1000, totalSeconds: (performance.now() - start) / 1000, backupBytes: dump.length, productionRpoVerified: false };
  await mkdir("artifacts/release", { recursive: true });
  await writeFile("artifacts/release/recovery.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(JSON.stringify({
    event: "recovery_drill_failed",
    stage,
    errorClass: error instanceof Error ? error.name : "unknown",
  }));
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map(c => c.$disconnect()));
  for (const key of keys) await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  for (const name of created) {
    if (!names.includes(name) || !/^orbit_recovery_test_[a-f0-9]{32}_(source|restored)$/.test(name)) throw new Error("Invalid cleanup target");
    docker(["dropdb", "-U", "orbit", name]);
  }
  storage.destroy();
}
