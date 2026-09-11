import "server-only";
import { AttachmentSchema, type AttachmentDTO } from "@/contracts";
import type { Attachment } from "@/generated/prisma/client";
export const uploaderInclude = {
  uploader: { select: { id: true, name: true } },
} as const;
export function toAttachmentDTO(
  row: Attachment & { uploader: { id: string; name: string } },
): AttachmentDTO {
  return AttachmentSchema.parse({
    id: row.id,
    taskId: row.taskId,
    uploader: {
      id: row.uploader.id,
      name: row.uploader.name.trim().slice(0, 40) || "未设置姓名",
    },
    uploadId: row.clientUploadId,
    fileName: row.originalName,
    mimeType: row.mimeType,
    declaredSizeBytes: Number(row.declaredSizeBytes),
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    state: row.state,
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
  });
}
