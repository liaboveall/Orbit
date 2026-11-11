"use client";

import { AlertCircle, Paperclip, RotateCcw, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, IconButton, InlineError, useToast } from "@/components/ui";
import { AttachmentSchema, type AttachmentDTO } from "@/contracts";
import { useUnsavedChanges } from "../unsaved-changes";
import { cn } from "@/lib/cn";
import {
  messageForError,
  redirectToLoginIfUnauthenticated,
  uploadAttachment,
} from "../api-helpers";
import {
  ALLOWED_FILE_EXTENSIONS,
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE_BYTES,
  formatFileSize,
  isAllowedExtension,
  isAllowedFileType,
  sha256Hex,
  uploadFilePart,
} from "./types";

/**
 * 附件上传入口（ORB-018）。真实 multipart 上传：本地预校验（类型/大小）→ 计算 sha256 →
 * 按契约字段顺序（uploadId → declaredSizeBytes → sha256 → file）经 XHR 上传并展示真实进度。
 *
 * 失败保留所选文件与同一 uploadId 以支持「重试」（服务端按 uploadId 去重）；上传中可取消。
 * 数量/存储配额由服务端强制（LIMIT_EXCEEDED），前端只做单文件 10 MiB 与类型的即时反馈，
 * 不臆造契约未暴露的配额数字。
 */
export function UploadButton({
  taskId,
  canWrite,
  onUploaded,
}: {
  taskId: string;
  /** 项目可写（未归档且为成员）。隐藏入口不构成权限控制，服务端始终重新校验。 */
  canWrite: boolean;
  /** 上传成功后通知容器刷新列表。 */
  onUploaded: (attachment: AttachmentDTO | null) => void;
}) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useUnsavedChanges(file !== null, uploading);
  useEffect(() => () => abortRef.current?.abort(), []);

  function reset() {
    setFile(null);
    setError(null);
    setProgress(0);
    uploadIdRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
  }

  function validate(candidate: File): string | null {
    if (candidate.size < 1) return "文件为空，无法上传。";
    if (candidate.size > MAX_FILE_SIZE_BYTES) {
      return `文件过大，单文件上限 ${formatFileSize(MAX_FILE_SIZE_BYTES)}。`;
    }
    const extension = candidate.name.split(".").pop()?.toLowerCase() ?? "";
    const extensionOk = isAllowedExtension(extension);
    const mimeOk = isAllowedFileType(candidate.type);
    // 某些浏览器不提供可靠 MIME，故扩展名与 MIME 有其一命中即放行，最终以服务端为准。
    if (!extensionOk && !mimeOk) {
      return `不支持的文件类型，仅支持 ${ALLOWED_FILE_EXTENSIONS.join(" / ")}。`;
    }
    return null;
  }

  function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    const invalid = validate(picked);
    if (invalid) {
      setError(invalid);
      setFile(null);
      uploadIdRef.current = null;
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setError(null);
    setProgress(0);
    uploadIdRef.current = crypto.randomUUID();
    setFile(picked);
  }

  async function handleUpload() {
    if (!file || !canWrite || uploading) return;
    const uploadId = uploadIdRef.current ?? crypto.randomUUID();
    uploadIdRef.current = uploadId;

    setUploading(true);
    setProgress(0);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const sha256 = await sha256Hex(file);
      controller.signal.throwIfAborted();
      // 契约要求的字段顺序：uploadId → declaredSizeBytes → sha256 → file。
      const form = new FormData();
      form.append("uploadId", uploadId);
      form.append("declaredSizeBytes", String(file.size));
      form.append("sha256", sha256);
      form.append("file", uploadFilePart(file), file.name);

      const res = await uploadAttachment(taskId, form, {
        onProgress: setProgress,
        signal: controller.signal,
      });

      if (!res.ok) {
        if (redirectToLoginIfUnauthenticated(res.status)) return;
        if (
          res.code === "IDEMPOTENCY_CONFLICT" ||
          res.code === "STORAGE_UNAVAILABLE" ||
          res.code === "VALIDATION_ERROR" ||
          res.code === "UNSUPPORTED_FILE_TYPE"
        )
          uploadIdRef.current = null;
        setError(messageForError(res.code, res.status, res.message));
        return;
      }

      const parsed = AttachmentSchema.safeParse(res.data);
      if (!parsed.success) throw new Error("Invalid attachment response");
      toast({ title: "附件已上传", variant: "success" });
      onUploaded(parsed.success ? parsed.data : null);
      reset();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // 用户取消：保留所选文件，允许重新上传。
        uploadIdRef.current = null;
        setProgress(0);
        return;
      }
      setError("无法连接服务器，文件已保留，请重试。");
    } finally {
      setUploading(false);
      abortRef.current = null;
    }
  }

  function handleCancel() {
    if (uploading) {
      abortRef.current?.abort();
      return;
    }
    reset();
  }

  if (!canWrite) return null;

  const percent = Math.round(progress * 100);
  const hasError = error !== null;

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={[
          ...ALLOWED_FILE_TYPES,
          ...ALLOWED_FILE_EXTENSIONS.map((x) => `.${x}`),
        ].join(",")}
        onChange={handleSelect}
        className="hidden"
        aria-label="选择要上传的文件"
      />

      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-tile bg-surface p-3 shadow-[inset_0_0_0_0.5px_var(--color-line)] transition-colors",
          hasError && "bg-danger-soft",
        )}
      >
        {file ? (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Paperclip
                className="h-4 w-4 shrink-0 text-foreground-secondary"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-label font-medium text-foreground"
                  title={file.name}
                >
                  {file.name}
                </p>
                <p className="text-caption text-foreground-muted">
                  {formatFileSize(file.size)}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {uploading ? (
                <>
                  <span
                    className="w-12 text-right text-caption tabular-nums text-foreground-muted"
                    aria-live="polite"
                  >
                    {percent}%
                  </span>
                  <IconButton label="取消上传" size="sm" onClick={handleCancel}>
                    <X className="h-4 w-4" />
                  </IconButton>
                </>
              ) : (
                <>
                  <Button size="sm" onClick={handleUpload}>
                    {hasError ? (
                      <RotateCcw
                        className="mr-1.5 h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                    ) : (
                      <Upload
                        className="mr-1.5 h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                    )}
                    {hasError ? "重试" : "上传"}
                  </Button>
                  <IconButton label="取消选择" size="sm" onClick={handleCancel}>
                    <X className="h-4 w-4" />
                  </IconButton>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Paperclip
                className="h-4 w-4 shrink-0 text-foreground-muted"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-label font-medium text-foreground">
                  上传附件
                </p>
                <p className="text-caption text-foreground-muted">
                  支持 {ALLOWED_FILE_EXTENSIONS.join(" / ")}，单文件至多{" "}
                  {formatFileSize(MAX_FILE_SIZE_BYTES)}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => inputRef.current?.click()}
            >
              选择文件
            </Button>
          </>
        )}
      </div>

      {uploading && (
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="上传进度"
        >
          <div
            className="h-full bg-brand transition-[width] duration-150 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {error && (
        <InlineError>
          <AlertCircle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
          {error}
        </InlineError>
      )}
    </div>
  );
}
