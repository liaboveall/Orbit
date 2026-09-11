import "server-only";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { getEnv, type OrbitEnv } from "@/server/env";
export function createS3Client(env: OrbitEnv): S3Client {
  return new S3Client({
    region: env.STORAGE_REGION,
    endpoint: env.STORAGE_ENDPOINT,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}
let client: S3Client | undefined;
export function getStorageClient() {
  return (client ??= createS3Client(getEnv()));
}
export async function putFile(
  key: string,
  path: string,
  size: number,
  mimeType: string,
  signal: AbortSignal,
) {
  const body = createReadStream(path);
  try {
    await getStorageClient().send(
      new PutObjectCommand({
        Bucket: getEnv().STORAGE_BUCKET,
        Key: key,
        Body: body,
        ContentLength: size,
        ContentType: mimeType,
      }),
      { abortSignal: signal },
    );
  } finally {
    body.destroy();
  }
}
export async function deleteObject(key: string) {
  await getStorageClient().send(
    new DeleteObjectCommand({ Bucket: getEnv().STORAGE_BUCKET, Key: key }),
    { abortSignal: AbortSignal.timeout(15000) },
  );
}
export async function streamDownload(
  key: string,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const response = await getStorageClient().send(
    new GetObjectCommand({ Bucket: getEnv().STORAGE_BUCKET, Key: key }),
    { abortSignal: signal },
  );
  if (!response.Body) throw new Error("Missing storage body");
  return response.Body.transformToWebStream();
}
