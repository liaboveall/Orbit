"use client";
import { useRouter } from "next/navigation";
import { useResourceRefresh } from "../use-resource-refresh";

import {
  Download,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { z } from "zod";
import { cn } from "@/lib/cn";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  InlineError,
  Skeleton,
  SkeletonBlock,
  useFocusReturn,
  useToast,
} from "@/components/ui";
import {
  AttachmentSchema,
  DownloadSchema,
  createApiClient,
  type AttachmentDTO,
} from "@/contracts";
import { SampleError } from "@/features/shell/state-views";
import {
  apiDelete,
  messageForError,
  redirectToLoginIfUnauthenticated,
} from "../api-helpers";
import { formatFileSize, getFileIcon } from "./types";
import { UploadButton } from "./upload-button";

const api = createApiClient();
const AttachmentListSchema = z.array(AttachmentSchema);

/**
 * 附件模块容器（ORB-018）。自取数据：GET /tasks/{id}/attachments（非分页，最多 10 条：
 * UPLOADING/READY + 最近 5 条 FAILED）。上传由 UploadButton 完成后触发 reload；下载走
 * GET /attachments/{id}/download 拿签名 URL 再触发浏览器下载；删除走 204（无 expectedVersion）。
 *
 * 六态：loading / empty / error（局部+重试）/ permission（403）/ 正常 / long-content（可滚动）。
 */
export function AttachmentList({
  taskId,
  revision,
  currentUserId,
  isProjectOwner,
  canWrite,
}: {
  taskId: string;
  revision?: string;
  currentUserId: string;
  /** 当前用户是否为项目 OWNER（可删除任意附件）。 */
  isProjectOwner: boolean;
  /** 项目可写（未归档且为成员），决定是否显示上传入口。 */
  canWrite: boolean;
}) {
  const router = useRouter();
  const [attachments, setAttachments] = useState<AttachmentDTO[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const generation = useRef(0);
  const load = useCallback(async () => {
    const epoch = ++generation.current;
    try {
      const res = await api.get(
        `/tasks/${taskId}/attachments`,
        AttachmentListSchema,
      );
      if (epoch !== generation.current) return;
      if (!res.ok) {
        if (redirectToLoginIfUnauthenticated(res.status)) return;
        if (res.status === 403 || res.status === 404) {
          setForbidden(true);
          router.refresh();
          return;
        }
        setLoadError(
          messageForError(res.error.code, res.status, "加载附件失败，请重试。"),
        );
        return;
      }
      setAttachments(res.data);
      setLoadError(null);
      setForbidden(false);
    } catch {
      if (epoch !== generation.current) return;
      setLoadError("无法连接服务器，请检查网络后重试。");
    }
  }, [taskId, router]);

  useResourceRefresh(load, revision);
  const changed = async () => {
    await load();
    router.refresh();
  };

  const total = attachments?.length ?? 0;

  return (
    <section className="space-y-3" aria-label="附件">
      <h2 className="flex items-center gap-2 text-label font-semibold text-foreground">
        <Paperclip
          className="h-4 w-4 text-foreground-muted"
          aria-hidden="true"
        />
        附件{total > 0 ? ` (${total})` : ""}
      </h2>

      {attachments === null && !loadError && !forbidden ? (
        <SkeletonBlock label="附件加载中" className="space-y-2">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </SkeletonBlock>
      ) : forbidden ? (
        <p className="text-caption text-foreground-muted">
          你没有查看该任务附件的权限。
        </p>
      ) : loadError ? (
        <div>
          <SampleError message={loadError} draftNote={null} />
          <div className="mt-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setLoadError(null);
                setAttachments(null);
                void load();
              }}
            >
              重新加载
            </Button>
          </div>
        </div>
      ) : (
        <>
          {total === 0 ? (
            <p className="text-caption text-foreground-muted">暂无附件。</p>
          ) : (
            <ul className="space-y-2" role="list">
              {attachments!.map((attachment) => (
                <AttachmentItem
                  key={attachment.id}
                  attachment={attachment}
                  currentUserId={currentUserId}
                  isProjectOwner={isProjectOwner}
                  canWrite={canWrite}
                  onReload={changed}
                />
              ))}
            </ul>
          )}

          <UploadButton
            taskId={taskId}
            canWrite={canWrite}
            onUploaded={() => void changed()}
          />
        </>
      )}
    </section>
  );
}

function AttachmentItem({
  attachment,
  currentUserId,
  isProjectOwner,
  canWrite,
  onReload,
}: {
  attachment: AttachmentDTO;
  currentUserId: string;
  isProjectOwner: boolean;
  canWrite: boolean;
  onReload: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { captureFocus, handleCloseAutoFocus } = useFocusReturn();
  const lock = useRef(false);

  const iconType = getFileIcon(attachment.mimeType);
  const isReady = attachment.state === "READY";
  const isUploading = attachment.state === "UPLOADING";
  const isFailed = attachment.state === "FAILED";
  const canDelete =
    canWrite && (attachment.uploader.id === currentUserId || isProjectOwner);
  const displaySize = attachment.sizeBytes ?? attachment.declaredSizeBytes;

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await api.get(
        `/attachments/${attachment.id}/download`,
        DownloadSchema,
      );
      if (!res.ok) {
        if (redirectToLoginIfUnauthenticated(res.status)) return;
        toast({
          title: messageForError(
            res.error.code,
            res.status,
            "下载失败，请稍后重试。",
          ),
          variant: "danger",
        });
        return;
      }
      // 签名 URL 有效期短（约 60s）：即时触发浏览器下载，不持久化。
      const anchor = document.createElement("a");
      anchor.href = res.data.url;
      anchor.download = res.data.fileName;
      anchor.rel = "noopener";
      anchor.target = "_blank";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      toast({ title: "无法连接服务器，请稍后重试。", variant: "danger" });
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete() {
    if (lock.current) return;
    lock.current = true;
    setDeleting(true);
    setError(null);
    try {
      const res = await apiDelete(`/attachments/${attachment.id}`);
      if (!res.ok) {
        if (redirectToLoginIfUnauthenticated(res.status)) return;
        if (res.status === 404) {
          setDeleteOpen(false);
          await onReload();
          return;
        }
        setError(messageForError(res.code, res.status, res.message));
        return;
      }
      setDeleteOpen(false);
      toast({ title: "附件已删除", variant: "success" });
      await onReload();
    } catch {
      setError("无法连接服务器，请稍后重试。");
    } finally {
      lock.current = false;
      setDeleting(false);
    }
  }

  return (
    <li
      className={cn(
        "group/row flex items-start gap-3 rounded-control border p-2 transition-colors",
        isFailed
          ? "border-danger bg-danger-soft"
          : "border-line hover:bg-surface-sunken",
      )}
    >
      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-foreground-secondary">
        {iconType === "image" ? (
          <ImageIcon className="h-5 w-5" aria-hidden="true" />
        ) : iconType === "text" ? (
          <FileText className="h-5 w-5" aria-hidden="true" />
        ) : (
          <FileIcon className="h-5 w-5" aria-hidden="true" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="break-all text-label font-medium text-foreground [overflow-wrap:anywhere]"
            title={attachment.fileName}
          >
            {attachment.fileName}
          </span>
          {isUploading && (
            <span className="inline-flex items-center gap-1 text-caption text-foreground-muted">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              上传中…
            </span>
          )}
          {isFailed && (
            <span className="inline-flex items-center gap-1 text-caption text-danger">
              <TriangleAlert className="h-3 w-3" aria-hidden="true" />
              失败
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-caption text-foreground-muted">
          <span>{formatFileSize(displaySize)}</span>
          <span aria-hidden="true">·</span>
          <span>
            {attachment.uploader.id === currentUserId
              ? "我"
              : attachment.uploader.name}
          </span>
          <span aria-hidden="true">·</span>
          <span>{new Date(attachment.createdAt).toLocaleDateString()}</span>
        </div>

        {isFailed && (
          <p className="text-caption text-danger">
            {messageForError(
              attachment.errorCode ?? undefined,
              0,
              "上传失败，可删除后重试。",
            )}
          </p>
        )}

        {error && <InlineError>{error}</InlineError>}
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 focus-within:opacity-100 group-hover/row:opacity-100">
        {isReady && (
          <IconButton
            label="下载附件"
            size="sm"
            onClick={handleDownload}
            disabled={downloading}
          >
            <Download className="h-4 w-4" />
          </IconButton>
        )}
        {canDelete && (
          <IconButton
            label="删除附件"
            size="sm"
            onClick={() => {
              captureFocus();
              setError(null);
              setDeleteOpen(true);
            }}
            disabled={deleting}
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!deleting) setDeleteOpen(open);
        }}
      >
        <DialogContent onCloseAutoFocus={handleCloseAutoFocus}>
          <DialogHeader>
            <DialogTitle>删除附件？</DialogTitle>
            <DialogDescription>
              「{attachment.fileName}」将被删除，此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          {error && <InlineError>{error}</InlineError>}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={deleting}
              onClick={() => setDeleteOpen(false)}
            >
              取消
            </Button>
            <Button variant="danger" disabled={deleting} onClick={handleDelete}>
              {deleting ? "删除中…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
