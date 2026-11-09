// Real disposable PostgreSQL + SeaweedFS backup/restore. Does not use .env or user volumes.
import { execFileSync, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { S3Client, HeadBucketCommand, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import assert from "node:assert/strict";
const name = `orbit-backup-test-${randomUUID().slice(0,8)}`;
const dir = resolve(`artifacts/${name}`);
await mkdir(dir, { recursive: true });
const file = `${dir}/compose.json`;
const config = { name, services: {
  postgres: { image: "postgres:17", environment: { POSTGRES_PASSWORD: "synthetic", POSTGRES_DB: "review" }, ports: ["127.0.0.1::5432"], healthcheck: { test: ["CMD-SHELL", "pg_isready -U postgres -d review"], interval: "1s", retries: 40 } },
  storage: { image: "chrislusf/seaweedfs:4.47@sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882", command: ["mini", "-dir=/data", "-bucket=review", "-master.telemetry=false"], volumes: ["objects:/data"], ports: ["127.0.0.1::8333"], environment: { AWS_ACCESS_KEY_ID: "synthetic", AWS_SECRET_ACCESS_KEY: "synthetic-password" }, healthcheck: { test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8333/healthz"], interval: "1s", retries: 40 } },
}, volumes: { objects: {} } };
await writeFile(file, JSON.stringify(config));
const docker = args => execFileSync("docker", args, { encoding: "utf8", windowsHide: true, timeout: 120000 }).trim();
const compose = args => docker(["compose", "-f", file, ...args]);
let db, storage;
try {
  compose(["up", "-d", "--wait"]);
  const pgPort = compose(["port", "postgres", "5432"]).split(":").at(-1);
  const s3Port = compose(["port", "storage", "8333"]).split(":").at(-1);
  db = new Client({ connectionString: `postgresql://postgres:synthetic@127.0.0.1:${pgPort}/review` });
  await db.connect();
  await db.query('CREATE TABLE "Attachment" (state text, object_key text); INSERT INTO "Attachment" VALUES (\'READY\', \'sample\'); CREATE TABLE "Blocker" (id int)');
  storage = new S3Client({ endpoint: `http://127.0.0.1:${s3Port}`, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic-password" }, maxAttempts: 1 });
  const readyBy = Date.now() + 15000;
  for (;;) {
    try { await storage.send(new HeadBucketCommand({ Bucket: "review" })); break; }
    catch (error) { if (Date.now() >= readyBy) throw error; await new Promise(r => setTimeout(r, 250)); }
  }
  const bytes = "synthetic frozen attachment";
  await storage.send(new PutObjectCommand({ Bucket: "review", Key: "sample", Body: bytes }));
  await db.query('BEGIN; LOCK TABLE "Blocker" IN ACCESS EXCLUSIVE MODE');
  const containerFile = `/source/artifacts/${name}/compose.json`;
  const child = spawn("docker", ["run", "--rm", "--mount", "type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock", "--mount", `type=bind,source=${process.cwd()},target=/source`, "-e", `ORBIT_COMPOSE_FILE=${containerFile}`, "-e", `ORBIT_BACKUP_DIR=/source/artifacts/${name}/backups`, "-e", "ORBIT_BACKUP_DATABASE=review", "docker:27-cli", "sh", "-c", "apk add --no-cache bash coreutils util-linux >/dev/null && bash /source/infra/backup-local.sh"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", b => { log += b; }); child.stderr.on("data", b => { log += b; });
  const done = new Promise((resolve, reject) => { child.on("error", reject); child.on("close", code => resolve(code)); });
  const deadline = Date.now() + 90000;
  let waiting = false;
  // Query from outside the lock-holder transaction to see pg_dump waiting for our blocker.
  while (Date.now() < deadline) {
    waiting = compose(["exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "review", "-Atc", "SELECT count(*) FROM pg_stat_activity WHERE application_name='pg_dump' AND wait_event_type='Lock'"]) !== "0";
    if (waiting) break;
    if (child.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 500));
  }
  assert(waiting, `Backup did not reach snapshot: ${log}`);
  await assert.rejects(storage.send(new DeleteObjectCommand({ Bucket: "review", Key: "sample" })));
  // The snapshot is already open; commit a later deletion while storage is frozen.
  compose(["exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "review", "-c", "UPDATE \"Attachment\" SET state='DELETED'"]);
  await db.query("ROLLBACK");
  assert.equal(await done, 0, log);
  compose(["exec", "-T", "postgres", "createdb", "-U", "postgres", "restored"]);
  // Restore both database and volume from the verified batch using an isolated controller.
  const command = `apk add --no-cache bash coreutils >/dev/null && batch=$(bash /source/infra/select-backup.sh) && docker compose -f "$ORBIT_COMPOSE_FILE" exec -T postgres pg_restore -U postgres -d restored < "$ORBIT_BACKUP_DIR/orbit-$batch.dump" && docker compose -f "$ORBIT_COMPOSE_FILE" stop storage && docker compose -f "$ORBIT_COMPOSE_FILE" run --rm --no-deps -T --user seaweed --entrypoint sh storage -c 'find /data -mindepth 1 -delete; tar -xzf - -C /data' < "$ORBIT_BACKUP_DIR/storage-$batch.tar.gz" && docker compose -f "$ORBIT_COMPOSE_FILE" start storage`;
  docker(["run", "--rm", "--mount", "type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock", "--mount", `type=bind,source=${process.cwd()},target=/source`, "-e", `ORBIT_COMPOSE_FILE=${containerFile}`, "-e", `ORBIT_BACKUP_DIR=/source/artifacts/${name}/backups`, "docker:27-cli", "sh", "-c", command]);
  compose(["up", "-d", "--wait"]);
  assert.equal(compose(["exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "restored", "-Atc", 'SELECT state FROM "Attachment"']), "READY");
  storage.destroy();
  const restoredPort = compose(["port", "storage", "8333"]).split(":").at(-1);
  storage = new S3Client({ endpoint: `http://127.0.0.1:${restoredPort}`, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic-password" }, maxAttempts: 3 });
  assert.equal(await (await storage.send(new GetObjectCommand({ Bucket: "review", Key: "sample" }))).Body.transformToString(), bytes);
  const result = { snapshotState: "READY", laterState: "DELETED", concurrentObjectDeletionBlocked: true, restoredBytesMatch: true, scope: "Real isolated database and storage, real backup script and paired restore" };
  await writeFile(`${dir}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, directory: dir }));
} finally {
  await db?.end(); storage?.destroy();
  // Only this generated Compose project's disposable resources.
  compose(["down", "-v"]);
}
