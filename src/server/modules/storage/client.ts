import "server-only";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { getEnv, type OrbitEnv } from "@/server/env";
import { guardDownloadStream } from "./download-stream";
import { logEvent } from "@/server/http/log";
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
/**
 * F15 修复：GetObject 下载的有界预算与完整性。
 *  - 建连预算：CONNECT 内未建立响应即失败（SDK 默认无超时，慢存储会无限挂起）；
 *  - 总预算：TOTAL 覆盖整个响应周期（含 body 流），存储中途停滞也会结束；
 *  - 客户端 abort（request.signal）与上述预算经 AbortSignal.any 合并；
 *  - 返回 S3 报告的可信 ContentLength，供路由设置 Content-Length —— 截断响应
 *    会被 HTTP 层检测（长度不符 → 网络错误），而不是静默交给用户损坏文件；
 *  - 流中止/错误记录脱敏事件（不含 objectKey 与用户信息）。
 */

/** GetObject 建连（send 返回）预算。 */
export const DOWNLOAD_CONNECT_TIMEOUT_MS = 10_000;
/** 整个下载（含 body 流）的总预算；到期强制结束停滞的流。 */
export const DOWNLOAD_TOTAL_TIMEOUT_MS = 120_000;

export interface DownloadResult {
  stream: ReadableStream<Uint8Array>;
  /** 存储端报告的对象长度（可信）；未知时为 null（此时不设置 Content-Length）。 */
  contentLength: number | null;
}

export async function streamDownload(
  key: string,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  const totalController = new AbortController();
  const connectController = new AbortController();
  const totalTimer = setTimeout(
    () => totalController.abort(),
    DOWNLOAD_TOTAL_TIMEOUT_MS,
  );
  // Release the total timer with the body lifecycle, not merely after headers.
  totalTimer.unref?.();
  const connectTimer = setTimeout(
    () => connectController.abort(),
    DOWNLOAD_CONNECT_TIMEOUT_MS,
  );
  connectTimer.unref?.();

  const signals: AbortSignal[] = [totalController.signal, connectController.signal];
  if (signal) signals.push(signal);
  const combined = AbortSignal.any(signals);

  try {
    const response = await getStorageClient().send(
      new GetObjectCommand({ Bucket: getEnv().STORAGE_BUCKET, Key: key }),
      { abortSignal: combined },
    );
    if (!response.Body) throw new Error("Missing storage body");
    const contentLength = typeof response.ContentLength === "number" ? response.ContentLength : null;
    return {
      stream: guardDownloadStream(response.Body.transformToWebStream(), contentLength, combined, () => clearTimeout(totalTimer)),
      contentLength,
    };
  } catch (error) {
    clearTimeout(totalTimer);
    logEvent("error", { event: "storage_download_failed", stage: "headers" });
    throw error;
  } finally {
    clearTimeout(connectTimer);
  }
}
