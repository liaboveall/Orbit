/**
 * 附件模块的客户端校验/展示辅助（ORB-018）。
 *
 * 这些是纯前端 UX 辅助：文件类型/大小预校验、图标与体积格式化。契约真源仍是
 * contracts/openapi.json —— 单文件上限 10 MiB 与允许类型均对齐服务端，前端预校验只为
 * 尽早反馈，最终以服务端校验为准（PAYLOAD_TOO_LARGE / UNSUPPORTED_FILE_TYPE / LIMIT_EXCEEDED）。
 */

/** 允许的文件 MIME 类型（对齐 docs/05 §8 上传白名单）。 */
export const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/markdown",
] as const;
export type AllowedFileType = (typeof ALLOWED_FILE_TYPES)[number];

/** 允许的扩展名（用于浏览器 accept 与 MIME 缺失时的兜底判断）。 */
export const ALLOWED_FILE_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "txt",
  "md",
] as const;
export type AllowedFileExtension = (typeof ALLOWED_FILE_EXTENSIONS)[number];
const MIME_BY_EXTENSION: Record<AllowedFileExtension, AllowedFileType> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  txt: "text/plain",
  md: "text/markdown",
};

/** Browsers may omit MIME for Markdown; the server still verifies actual bytes. */
export function uploadFilePart(file: File): Blob {
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  return !file.type && isAllowedExtension(extension)
    ? new Blob([file], { type: MIME_BY_EXTENSION[extension] })
    : file;
}

/** 单文件大小上限：10 MiB（openapi AttachmentSize maximum:10485760）。 */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export function isAllowedFileType(
  mimeType: string,
): mimeType is AllowedFileType {
  return (ALLOWED_FILE_TYPES as readonly string[]).includes(mimeType);
}

export function isAllowedExtension(
  extension: string,
): extension is AllowedFileExtension {
  return (ALLOWED_FILE_EXTENSIONS as readonly string[]).includes(
    extension.toLowerCase(),
  );
}

/** 人类可读的文件体积。 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 依据 MIME 类型选择展示图标类别。 */
export function getFileIcon(
  mimeType: string,
): "file" | "image" | "pdf" | "text" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("text/")) return "text";
  return "file";
}

/**
 * 计算文件的 SHA-256（小写十六进制），用于上传去重与完整性校验（contract UploadAttachment.sha256）。
 * 依赖 SubtleCrypto，需安全上下文（https 或 localhost）。
 */
export async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
