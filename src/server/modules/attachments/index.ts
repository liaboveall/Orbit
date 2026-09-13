import "server-only";

/**
 * 附件域公共出口（M5 / ORB-018）。
 * 路由层只从此处导入，不直连内部文件。
 */

export {
  listAttachments,
  uploadAttachment,
  deleteAttachment,
  downloadAttachment,
} from "./service";
export { type UploadAttachmentResult } from "./service";
export { toAttachmentDTO } from "./mappers";
export {
  attachmentNotFoundError,
  attachmentLimitExceededError,
  storageQuotaExceededError,
  unsupportedFileTypeError,
  fileSizeExceededError,
  uploadInProgressError,
  idempotencyConflictError,
} from "./access";
