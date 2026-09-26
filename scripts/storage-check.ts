import dotenv from "dotenv";
import { randomUUID } from "node:crypto";

// Writes, reads back and deletes one probe object with the application's own environment
// validation and S3 client, so a deployment can verify storage before any user uploads.
// Operations image: node --conditions=react-server --import tsx scripts/storage-check.ts
dotenv.config({ path: [".env.local", ".env"], quiet: true });
const { getEnv } = await import("../src/server/env");
const { createS3Client } = await import("../src/server/modules/storage/client");
const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");

const env = getEnv();
const client = createS3Client(env);
const Bucket = env.STORAGE_BUCKET;
const Key = `ops/storage-check/${randomUUID()}`;
const body = `orbit storage check ${Key}`;
const options = () => ({ abortSignal: AbortSignal.timeout(15000) });
let stage = "put";
try {
  await client.send(new PutObjectCommand({ Bucket, Key, Body: body, ContentType: "text/plain" }), options());
  stage = "get";
  const response = await client.send(new GetObjectCommand({ Bucket, Key }), options());
  if ((await response.Body?.transformToString()) !== body) throw new Error("Storage content mismatch");
  stage = "delete";
  await client.send(new DeleteObjectCommand({ Bucket, Key }), options());
  console.log(JSON.stringify({ event: "storage_check_passed", bucket: Bucket }));
} catch (error) {
  // Report the failing stage and error class only; never credentials or raw messages.
  console.log(JSON.stringify({ event: "storage_check_failed", stage, error: error instanceof Error ? error.name : "unknown" }));
  if (stage !== "put") await client.send(new DeleteObjectCommand({ Bucket, Key }), options()).catch(() => undefined);
  process.exitCode = 1;
} finally {
  client.destroy();
}
