import "server-only";
import { DomainError } from "@/server/http/errors";
import {
  MAX_ACTIVE_ATTACHMENTS_PER_TASK,
  MAX_ATTACHMENT_BYTES,
  MAX_PROJECT_STORAGE_BYTES,
} from "@/server/modules/limits";

/**
 * 附件域错误与配额辅助（M5 / ORB-018，docs/01 §8）。
 *
 * 权限矩阵（docs/01 §8）：
 *  - 上传附件：owner + member 均可；
 *  - 删除附件：owner 可删任意 / member 仅删自己上传的（403 FORBIDDEN）。
 */

/** 附件不可见 —— 统一 404。 */
export function attachmentNotFoundError(): DomainError {
  return new DomainError("NOT_FOUND", "附件不存在或你无权访问。");
}

/** 每任务有效附件数超上限 —— 422 LIMIT_EXCEEDED。 */
export function attachmentLimitExceededError(): DomainError {
  return new DomainError(
    "LIMIT_EXCEEDED",
    `每个任务最多 ${MAX_ACTIVE_ATTACHMENTS_PER_TASK} 个有效附件，请先删除部分附件。`,
  );
}

/** 存储配额不足 —— 422 LIMIT_EXCEEDED。 */
export function storageQuotaExceededError(): DomainError {
  return new DomainError(
    "LIMIT_EXCEEDED",
    `已超出项目存储空间限制（${Number(MAX_PROJECT_STORAGE_BYTES) / Number(1024n * 1024n)} MiB）。`,
  );
}

/** 文件类型不支持 —— 415 UNSUPPORTED_FILE_TYPE。 */
export function unsupportedFileTypeError(mimeType: string): DomainError {
  return new DomainError(
    "UNSUPPORTED_FILE_TYPE",
    `不支持的文件类型 "${mimeType}"，允许：PDF/PNG/JPEG/WebP/TXT/MD。`,
  );
}

/** 文件大小超出限制 —— 413 PAYLOAD_TOO_LARGE。 */
export function fileSizeExceededError(size: number): DomainError {
  return new DomainError(
    "PAYLOAD_TOO_LARGE",
    `文件大小 ${size} 字节超出限制（最大 ${MAX_ATTACHMENT_BYTES} 字节）。`,
  );
}

/** 上传进行中 —— 409 UPLOAD_IN_PROGRESS。 */
export function uploadInProgressError(uploadId: string): DomainError {
  return new DomainError(
    "UPLOAD_IN_PROGRESS",
    `该 uploadId (${uploadId}) 的上传正在进行中。`,
  );
}

/** 幂等冲突 —— 409 IDEMPOTENCY_CONFLICT。 */
export function idempotencyConflictError(uploadId: string): DomainError {
  return new DomainError(
    "IDEMPOTENCY_CONFLICT",
    `该 uploadId (${uploadId}) 已关联其他附件，请生成新 key 后重试。`,
  );
}

/** 孤儿清理未成功 —— 服务层不应直接抛此错，由补偿脚本处理。 */
export class CleanupFailedError extends Error {
  readonly attachmentId: string;
  readonly errorCode: string;
  constructor(attachmentId: string, errorCode: string) {
    super(`附件 ${attachmentId} 清理失败：${errorCode}`);
    this.name = "CleanupFailedError";
    this.attachmentId = attachmentId;
    this.errorCode = errorCode;
  }
}

/**
 * 统计某任务有效附件数（state ∈ {UPLOADING, READY}）。
 */

/**
 * 判定是否可删除附件：作者本人 OR 项目 owner（docs/01 §8）。
 */

/** MIME 白名单（docs/01 §8）。 */

/** 验证文件类型，失败时抛错。 */
