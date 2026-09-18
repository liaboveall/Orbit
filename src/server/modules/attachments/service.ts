import "server-only";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { prisma } from "@/server/db/prisma";
import { lockProjectRow, withTransaction } from "@/server/db/tx";
import { DomainError } from "@/server/http/errors";
import {
  UploadAttachmentMetaSchema,
  SignedDownloadQuerySchema,
  UuidSchema,
  DownloadSchema,
  type AttachmentDTO,
  type UploadAttachmentMetaDTO,
} from "@/contracts";
import {
  locateTaskProject,
  requireWritableTaskSubresource,
  resolveReadableTaskSubresource,
  touchTaskUpdatedAt,
} from "@/server/modules/task/subresource";
import { appendActivity } from "@/server/modules/activity/writer";
import { formatIdentifier } from "@/server/modules/task/identifier";
import {
  MAX_ACTIVE_ATTACHMENTS_PER_TASK,
  MAX_PROJECT_STORAGE_BYTES,
} from "@/server/modules/limits";
import { getEnv } from "@/server/env";
import { putFile, streamDownload } from "@/server/modules/storage/client";
import { receiveValidatedFile, validateFileNameType } from "./file-validation";
import { toAttachmentDTO, uploaderInclude } from "./mappers";
import {
  attachmentNotFoundError,
  attachmentLimitExceededError,
  storageQuotaExceededError,
} from "./access";

export interface UploadAttachmentResult {
  attachment: AttachmentDTO;
  replayed: boolean;
}
export async function listAttachments(
  taskId: string,
  userId: string,
): Promise<AttachmentDTO[]> {
  await resolveReadableTaskSubresource(taskId, userId);
  const [active, failed] = await Promise.all([
    prisma.attachment.findMany({
      where: { taskId, deletedAt: null, state: { in: ["UPLOADING", "READY"] } },
      include: uploaderInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    prisma.attachment.findMany({
      where: { taskId, deletedAt: null, state: "FAILED" },
      include: uploaderInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
    }),
  ]);
  return [...active, ...failed]
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        b.id.localeCompare(a.id),
    )
    .map(toAttachmentDTO);
}
export async function uploadAttachment(
  taskId: string,
  userId: string,
  metadata: UploadAttachmentMetaDTO,
  file: { fileName: string; mimeType: string; stream: Readable },
  options: { signal: AbortSignal; complete?: Promise<unknown> },
): Promise<UploadAttachmentResult> {
  const parsed = UploadAttachmentMetaSchema.safeParse(metadata);
  if (!parsed.success)
    throw new DomainError("VALIDATION_ERROR", "上传元信息不合法。");
  const meta = parsed.data;
  validateFileNameType(file.fileName, file.mimeType);
  const projectId = await locateTaskProject(taskId);
  const reservation = await withTransaction(async (tx) => {
    await lockProjectRow(tx, projectId);
    const { access } = await requireWritableTaskSubresource(
      tx,
      projectId,
      taskId,
      userId,
    );
    const existing = await tx.attachment.findUnique({
      where: {
        taskId_uploaderId_clientUploadId: {
          taskId,
          uploaderId: userId,
          clientUploadId: meta.uploadId,
        },
      },
      include: uploaderInclude,
    });
    if (existing) {
      if (
        existing.originalName !== file.fileName ||
        existing.mimeType !== file.mimeType ||
        existing.declaredSizeBytes !== BigInt(meta.declaredSizeBytes) ||
        existing.claimedSha256 !== meta.sha256
      )
        throw new DomainError(
          "IDEMPOTENCY_CONFLICT",
          "该上传标识已用于不同文件。",
        );
      if (existing.state === "UPLOADING")
        throw new DomainError(
          "UPLOAD_IN_PROGRESS",
          "文件仍在上传，请稍后重试。",
        );
      if (existing.state !== "READY" || existing.deletedAt)
        throw new DomainError(
          "IDEMPOTENCY_CONFLICT",
          "该上传已失败或删除，请重新选择文件。",
        );
      return { row: existing, replayed: true };
    }
    if (
      (await tx.attachment.count({
        where: {
          taskId,
          state: { in: ["UPLOADING", "READY"] },
          deletedAt: null,
        },
      })) >= MAX_ACTIVE_ATTACHMENTS_PER_TASK
    )
      throw attachmentLimitExceededError();
    if (
      access.project.usedBytes +
        access.project.reservedBytes +
        BigInt(meta.declaredSizeBytes) >
      MAX_PROJECT_STORAGE_BYTES
    )
      throw storageQuotaExceededError();
    const id = randomUUID();
    const row = await tx.attachment.create({
      data: {
        id,
        taskId,
        projectId,
        uploaderId: userId,
        clientUploadId: meta.uploadId,
        originalName: file.fileName,
        mimeType: file.mimeType,
        claimedSha256: meta.sha256,
        declaredSizeBytes: BigInt(meta.declaredSizeBytes),
        objectKey: ["projects", projectId, "tasks", taskId, id].join("/"),
        state: "UPLOADING",
      },
      include: uploaderInclude,
    });
    await tx.project.update({
      where: { id: projectId },
      data: { reservedBytes: { increment: BigInt(meta.declaredSizeBytes) } },
    });
    return { row, replayed: false };
  });
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "orbit-upload-"));
    const path = join(directory, "content");
    await receiveValidatedFile(
      file.stream,
      path,
      meta,
      file.mimeType,
      options.signal,
    );
    await options.complete;
    options.signal.throwIfAborted();
    if (!reservation.replayed)
      await putFile(
        reservation.row.objectKey,
        path,
        meta.declaredSizeBytes,
        file.mimeType,
        options.signal,
      );
    return await withTransaction(async (tx) => {
      await lockProjectRow(tx, projectId);
      const { task, access } = await requireWritableTaskSubresource(
        tx,
        projectId,
        taskId,
        userId,
      );
      const current = await tx.attachment.findUnique({
        where: { id: reservation.row.id },
        include: uploaderInclude,
      });
      if (
        !current ||
        current.state !== (reservation.replayed ? "READY" : "UPLOADING") ||
        current.deletedAt
      )
        throw attachmentNotFoundError();
      if (reservation.replayed)
        return { attachment: toAttachmentDTO(current), replayed: true };
      const ready = await tx.attachment.update({
        where: { id: current.id },
        data: {
          state: "READY",
          sizeBytes: BigInt(meta.declaredSizeBytes),
          sha256: meta.sha256,
        },
        include: uploaderInclude,
      });
      await tx.project.update({
        where: { id: projectId },
        data: {
          reservedBytes: { decrement: current.declaredSizeBytes },
          usedBytes: { increment: current.declaredSizeBytes },
        },
      });
      await touchTaskUpdatedAt(tx, taskId);
      await appendActivity(tx, {
        projectId,
        actorId: userId,
        entityType: "ATTACHMENT",
        entityId: current.id,
        action: "FILE_UPLOADED",
        metadata: {
          taskIdentifier: formatIdentifier(access.project.key, task.number),
        },
      });
      return { attachment: toAttachmentDTO(ready), replayed: false };
    });
  } catch (error) {
    if (!reservation.replayed)
      await failUpload(
        reservation.row.id,
        error instanceof DomainError ? error.code : "STORAGE_UNAVAILABLE",
      );
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      "STORAGE_UNAVAILABLE",
      "上传未完成，请重新选择文件后重试。",
    );
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
export async function failUpload(id: string, code: string) {
  const locator = await prisma.attachment.findUnique({
    where: { id },
    select: { projectId: true },
  });
  if (!locator) return;
  await withTransaction(async (tx) => {
    await lockProjectRow(tx, locator.projectId);
    const row = await tx.attachment.findUnique({ where: { id } });
    if (!row || row.state === "READY") return;
    if (row.state === "UPLOADING") {
      await tx.project.update({
        where: { id: row.projectId },
        data: { reservedBytes: { decrement: row.declaredSizeBytes } },
      });
      await tx.attachment.update({
        where: { id },
        data: { state: "FAILED", errorCode: code, cleanupPending: true },
      });
    } else
      await tx.attachment.update({
        where: { id },
        data: { cleanupPending: true },
      });
  });
}
async function locateAttachment(id: string) {
  if (!UuidSchema.safeParse(id).success) throw attachmentNotFoundError();
  const row = await prisma.attachment.findUnique({ where: { id } });
  if (!row) throw attachmentNotFoundError();
  return row;
}
export async function deleteAttachment(
  id: string,
  userId: string,
): Promise<void> {
  const locator = await locateAttachment(id);
  await withTransaction(async (tx) => {
    await lockProjectRow(tx, locator.projectId);
    const { task, access } = await requireWritableTaskSubresource(
      tx,
      locator.projectId,
      locator.taskId,
      userId,
    );
    const row = await tx.attachment.findUnique({ where: { id } });
    if (!row || row.deletedAt) throw attachmentNotFoundError();
    if (row.uploaderId !== userId && access.role !== "OWNER")
      throw new DomainError("FORBIDDEN", "无权删除该附件。");
    await tx.project.update({
      where: { id: row.projectId },
      data: {
        usedBytes: {
          decrement: row.state === "READY" ? (row.sizeBytes ?? 0n) : 0n,
        },
        reservedBytes: {
          decrement: row.state === "UPLOADING" ? row.declaredSizeBytes : 0n,
        },
      },
    });
    await tx.attachment.update({
      where: { id },
      data: {
        state: "DELETED",
        deletedAt: new Date(),
        cleanupPending: true,
        errorCode: null,
      },
    });
    await touchTaskUpdatedAt(tx, row.taskId);
    await appendActivity(tx, {
      projectId: row.projectId,
      actorId: userId,
      entityType: "ATTACHMENT",
      entityId: id,
      action: "FILE_DELETED",
      metadata: {
        taskIdentifier: formatIdentifier(access.project.key, task.number),
      },
    });
  });
}
async function readableAttachment(id: string, userId: string) {
  const row = await locateAttachment(id);
  await resolveReadableTaskSubresource(row.taskId, userId);
  if (row.state !== "READY" || row.deletedAt) throw attachmentNotFoundError();
  return row;
}
function signature(id: string, userId: string, expires: string) {
  return createHmac("sha256", getEnv().BETTER_AUTH_SECRET)
    .update(JSON.stringify(["attachment-download-v1", id, userId, expires]))
    .digest("hex");
}
export async function downloadAttachment(id: string, userId: string) {
  const row = await readableAttachment(id, userId);
  const expires = String(Date.now() + 60000);
  const url = new URL(
    "/api/v1/attachments/" + id + "/content",
    getEnv().BETTER_AUTH_URL,
  );
  url.searchParams.set("expires", expires);
  url.searchParams.set("signature", signature(id, userId, expires));
  return DownloadSchema.parse({
    url: url.href,
    expiresAt: new Date(Number(expires)).toISOString(),
    fileName: row.originalName,
  });
}
export async function downloadContent(
  id: string,
  userId: string,
  expires: string,
  mac: string,
  signal?: AbortSignal,
) {
  if (
    !SignedDownloadQuerySchema.safeParse({ expires, signature: mac }).success ||
    Number(expires) <= Date.now() ||
    Number(expires) > Date.now() + 60000 ||
    !timingSafeEqual(
      Buffer.from(signature(id, userId, expires), "hex"),
      Buffer.from(mac, "hex"),
    )
  )
    throw attachmentNotFoundError();
  const row = await readableAttachment(id, userId);
  try {
    // F15：同时返回存储端可信长度，供 HTTP 层设置 Content-Length（截断可被检测）。
    const download = await streamDownload(row.objectKey, signal);
    return {
      stream: download.stream,
      contentLength: download.contentLength,
      fileName: row.originalName,
    };
  } catch {
    throw new DomainError(
      "STORAGE_UNAVAILABLE",
      "文件暂时无法下载，请稍后重试。",
    );
  }
}
