"use client";

import { useUnsavedChanges } from "../unsaved-changes";
import { formatEventDateTime, useUserTimezone } from "@/lib/user-timezone";
import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  InlineError,
  Textarea,
  useFocusReturn,
  useToast,
} from "@/components/ui";
import { CommentSchema, createApiClient, type CommentDTO } from "@/contracts";
import {
  apiDelete,
  messageForError,
  redirectToLoginIfUnauthenticated,
} from "../api-helpers";

const api = createApiClient();
const BODY_MAX = 2000;

/**
 * 单条评论：纯文本展示（`<pre>`，脚本文本不执行）、作者编辑、作者或项目 owner 删除（软删除）。
 *
 * 乐观并发：编辑以 `base` 为 expectedVersion；服务端 409 时不静默覆盖，先 `onReload` 拉取远端
 * 并展示，用户在「采用远端内容」与「保留我的修改并重试」间明确选择（复用 subtask-item 冲突范式）。
 */
export function CommentItem({
  comment,
  currentUserId,
  isProjectOwner,
  canWrite,
  disabled,
  onBusyChange,
  onReload,
  unavailable = false,
  onEditingChange,
}: {
  comment: CommentDTO;
  currentUserId: string;
  /** 当前用户是否为项目 OWNER（可删除任意评论）。 */
  isProjectOwner: boolean;
  /** 项目可写（未归档且为成员）；隐藏按钮不构成权限控制，服务端始终重新校验。 */
  canWrite: boolean;
  /** 列表中已有其他写操作在进行时禁用本行交互。 */
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  /** 重新拉取列表；返回后本条 comment prop 会更新为远端最新值。 */
  onReload: () => Promise<void>;
  unavailable?: boolean;
  onEditingChange: (id: string, editing: boolean) => void;
}) {
  const { toast } = useToast();
  const tz = useUserTimezone(); // F23：账户时区。
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body ?? "");
  const [base, setBase] = useState(comment.version);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  useUnsavedChanges(editing, saving);
  useEffect(() => {
    onEditingChange(comment.id, editing);
    return () => onEditingChange(comment.id, false);
  }, [comment.id, editing, onEditingChange]);
  const lock = useRef(false);
  const { captureFocus, handleCloseAutoFocus } = useFocusReturn();

  const isDeleted = comment.isDeleted || comment.body === null;
  const isAuthor = comment.author.id === currentUserId;
  const canEdit = canWrite && !isDeleted && isAuthor;
  const canDelete = canWrite && !isDeleted && (isAuthor || isProjectOwner);

  // 非编辑态时跟随远端最新值（onReload 后 comment prop 变化）。

  function begin() {
    if (!canEdit || disabled) return;
    setDraft(comment.body ?? "");
    setBase(comment.version);
    setEditing(true);
    setError(null);
    setConflict(false);
  }

  function cancel() {
    if (lock.current) return;
    setEditing(false);
    setConflict(false);
    setError(null);
    setDraft(comment.body ?? "");
    setBase(comment.version);
  }

  function beginWrite() {
    lock.current = true;
    setSaving(true);
    onBusyChange(true);
    setError(null);
  }
  function endWrite() {
    lock.current = false;
    setSaving(false);
    onBusyChange(false);
  }

  async function handleSave() {
    if (lock.current || !canEdit) return;
    const body = draft.trim();
    if (!body) {
      setError("评论内容不能为空。");
      return;
    }
    if (body.length > BODY_MAX) {
      setError(`评论不能超过 ${BODY_MAX} 个字符。`);
      return;
    }
    if (body === (comment.body ?? "")) {
      cancel();
      return;
    }
    beginWrite();
    try {
      const res = await api.patch(`/comments/${comment.id}`, CommentSchema, {
        expectedVersion: base,
        body,
      });
      if (!res.ok) {
        if (redirectToLoginIfUnauthenticated(res.status)) return;
        if (res.error.code === "VERSION_CONFLICT") {
          setConflict(true);
          await onReload();
        } else if (res.status === 404) {
          toast({ title: "评论已被删除", variant: "info" });
          await onReload();
        } else {
          setError(
            messageForError(res.error.code, res.status, res.error.message),
          );
        }
        return;
      }
      toast({ title: "评论已更新", variant: "success" });
      setEditing(false);
      setConflict(false);
      await onReload();
    } catch {
      setError("无法连接服务器，你的修改已保留，请重试。");
    } finally {
      endWrite();
    }
  }

  async function handleDelete() {
    if (lock.current) return;
    beginWrite();
    try {
      const res = await apiDelete(`/comments/${comment.id}`, {
        expectedVersion: comment.version,
      });
      if (!res.ok) {
        if (redirectToLoginIfUnauthenticated(res.status)) return;
        if (res.status === 404) {
          setDeleteOpen(false);
          await onReload();
          return;
        }
        if (res.code === "VERSION_CONFLICT") {
          setError("评论已被更新，已刷新，请确认后重试。");
          await onReload();
          return;
        }
        setError(messageForError(res.code, res.status, res.message));
        return;
      }
      setDeleteOpen(false);
      toast({ title: "评论已删除", variant: "success" });
      await onReload();
    } catch {
      setError("无法连接服务器，请稍后重试。");
    } finally {
      endWrite();
    }
  }

  // F23 修复：评论时间用账户时区（原 toLocaleString 用设备时区）。
  const createdLabel = formatEventDateTime(comment.createdAt, tz);

  if (unavailable && !editing) return null;
  return (
    <li className="group/comment relative flex items-start gap-2.5 rounded-[12px] px-2 py-2 transition-colors hover:bg-surface-sunken">
      <Avatar name={comment.author.name} size="sm" />

      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-baseline gap-2 text-caption">
          <span className="font-medium text-foreground">
            {comment.author.name}
          </span>
          <span className="text-foreground-muted" title={createdLabel}>
            {createdLabel}
          </span>
          {comment.editedAt && (
            <span className="text-foreground-muted">（已编辑）</span>
          )}
        </p>

        {editing ? (
          <div className="space-y-2">
            {!canEdit && <p role="status">内容已不可编辑，草稿保留供复制。</p>}
            <Textarea
              value={draft}
              readOnly={!canEdit}
              disabled={saving}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
                  e.stopPropagation();
                  return;
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  if (draft !== (comment.body ?? "") && !window.confirm("确定放弃当前评论修改？")) {
                    return;
                  }
                  cancel();
                }
                // Enter 不提交：评论允许多行，避免误触。
              }}
              aria-label="编辑评论内容"
              className="md:text-label"
              rows={3}
              maxLength={BODY_MAX}
              autoFocus
            />
            {conflict && (
              <div
                role="alert"
                className="space-y-2 rounded-[12px] bg-surface-sunken p-2.5 text-caption"
              >
                <p className="font-medium text-foreground">
                  该评论已被更新（版本 {comment.version}）
                </p>
                <p className="whitespace-pre-wrap text-foreground-secondary [overflow-wrap:anywhere]">
                  远端当前内容：{comment.body ?? "（已删除）"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={saving}
                    onClick={() => {
                      setDraft(comment.body ?? "");
                      setBase(comment.version);
                      setConflict(false);
                      setEditing(false);
                    }}
                  >
                    采用远端内容
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => {
                      setBase(comment.version);
                      setConflict(false);
                    }}
                  >
                    保留我的修改并重试
                  </Button>
                </div>
              </div>
            )}
            {error && <InlineError>{error}</InlineError>}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !canEdit || conflict || !draft.trim()}
              >
                {saving ? "保存中…" : "保存"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={cancel}
                disabled={saving}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <>
            {isDeleted ? (
              <p className="text-label italic text-foreground-muted">
                该评论已删除。
              </p>
            ) : (
              <pre
                className="whitespace-pre-wrap font-sans text-label text-foreground-secondary [overflow-wrap:anywhere]"
                tabIndex={0}
              >
                {comment.body}
              </pre>
            )}

            {(canEdit || canDelete) && (
              <div className="flex items-center gap-1 transition-opacity sm:absolute sm:right-1.5 sm:top-1.5 sm:opacity-0 focus-within:opacity-100 group-hover/comment:opacity-100">
                {canEdit && (
                  <IconButton
                    label="编辑评论"
                    size="sm"
                    className="sm:h-6 sm:w-6"
                    onClick={begin}
                    disabled={disabled}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </IconButton>
                )}
                {canDelete && (
                  <IconButton
                    label="删除评论"
                    size="sm"
                    className="sm:h-6 sm:w-6"
                    onClick={() => {
                      captureFocus();
                      setError(null);
                      setDeleteOpen(true);
                    }}
                    disabled={disabled}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!saving) setDeleteOpen(open);
        }}
      >
        <DialogContent onCloseAutoFocus={handleCloseAutoFocus}>
          <DialogHeader>
            <DialogTitle>删除评论？</DialogTitle>
            <DialogDescription>
              此操作无法撤销，评论将被删除并保留为占位。
            </DialogDescription>
          </DialogHeader>
          {error && <InlineError>{error}</InlineError>}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => setDeleteOpen(false)}
            >
              取消
            </Button>
            <Button variant="danger" disabled={saving} onClick={handleDelete}>
              {saving ? "删除中…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
