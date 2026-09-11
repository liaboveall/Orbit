import "server-only";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DomainError } from "@/server/http/errors";
import { MAX_ATTACHMENT_BYTES } from "@/server/modules/limits";
import type { UploadAttachmentMetaDTO } from "@/contracts";

const types: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "text/plain": ["txt"],
  "text/markdown": ["md"],
};
const unsupported = () =>
  new DomainError(
    "UNSUPPORTED_FILE_TYPE",
    "文件扩展名、类型或实际内容不受支持。",
  );
export function validateFileNameType(fileName: string, mimeType: string) {
  if (
    !fileName.trim() ||
    fileName.length > 255 ||
    /[\x00-\x1f\x7f/\\]/.test(fileName)
  )
    throw unsupported();
  if (
    !types[mimeType]?.includes(fileName.split(".").at(-1)?.toLowerCase() ?? "")
  )
    throw unsupported();
}
export async function receiveValidatedFile(
  stream: Readable,
  path: string,
  meta: UploadAttachmentMetaDTO,
  mimeType: string,
  signal: AbortSignal,
): Promise<void> {
  let size = 0,
    prefix = Buffer.alloc(0),
    tail = "";
  const hash = createHash("sha256");
  const decoder = mimeType.startsWith("text/")
    ? new TextDecoder("utf-8", { fatal: true })
    : null;
  const inspectText = (text: string) => {
    const joined = tail + text;
    if (
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(joined) ||
      /<\s*(?:!doctype|html\b|head\b|body\b|script\b|svg\b|iframe\b)/i.test(
        joined,
      )
    )
      throw unsupported();
    tail = joined.slice(-128);
  };
  const validator = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        size += chunk.length;
        if (size > MAX_ATTACHMENT_BYTES)
          throw new DomainError("PAYLOAD_TOO_LARGE", "文件不能超过 10 MiB。");
        if (size > meta.declaredSizeBytes)
          throw new DomainError(
            "VALIDATION_ERROR",
            "文件实际大小与声明不一致。",
          );
        hash.update(chunk);
        if (prefix.length < 16)
          prefix = Buffer.concat([
            prefix,
            chunk.subarray(0, 16 - prefix.length),
          ]);
        if (decoder) inspectText(decoder.decode(chunk, { stream: true }));
        callback(null, chunk);
      } catch (error) {
        callback(error instanceof DomainError ? error : unsupported());
      }
    },
  });
  await pipeline(
    stream,
    validator,
    createWriteStream(path, { flags: "wx", mode: 0o600 }),
    { signal },
  );
  if (decoder) {
    try {
      inspectText(decoder.decode());
    } catch {
      throw unsupported();
    }
  }
  if (
    size !== meta.declaredSizeBytes ||
    size === 0 ||
    hash.digest("hex") !== meta.sha256
  )
    throw new DomainError(
      "VALIDATION_ERROR",
      "文件大小或 SHA-256 摘要不匹配。",
    );
  const valid =
    decoder ||
    (mimeType === "application/pdf" &&
      prefix.subarray(0, 5).toString() === "%PDF-") ||
    (mimeType === "image/png" &&
      prefix.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) ||
    (mimeType === "image/jpeg" &&
      prefix.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) ||
    (mimeType === "image/webp" &&
      prefix.subarray(0, 4).toString() === "RIFF" &&
      prefix.subarray(8, 12).toString() === "WEBP");
  if (!valid) throw unsupported();
}
