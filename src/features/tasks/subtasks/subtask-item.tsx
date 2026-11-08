"use client";

import { useUnsavedChanges } from "../unsaved-changes";
import { Check, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
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
  Textarea,
  useFocusReturn,
  useToast,
} from "@/components/ui";
import { createApiClient, SubtaskSchema, type SubtaskDTO } from "@/contracts";
import {
  apiDelete,
  messageForError,
  redirectToLoginIfUnauthenticated,
} from "../api-helpers";

const api = createApiClient();
const TITLE_MAX = 200;

/**
 * 单个子任务行：勾选完成 / 双击或按钮编辑标题 / 删除（带确认）。
 *
 * 乐观并发：编辑以 `base` 版本为 expectedVersion 提交；服务端 409 时不静默丢弃，
 * 而是先刷新拿到远端内容（`onReload`）并展示，让用户在「采用远端」与「保留我的修改并重试」
 * 间明确选择（docs/02 §7、复用 task-editor.tsx 的冲突范式）。
 */
export function SubtaskItem({
  subtask,
  canEdit,
  disabled,
  onBusyChange,
  onReload,
}: {
  subtask: SubtaskDTO;
  canEdit: boolean;
  /** 列表中已有其他写操作在进行时禁用本行交互。 */
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  /** 重新拉取列表；返回后本行的 subtask prop 会更新为远端最新值。 */
  onReload: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(subtask.title);
  const [base, setBase] = useState(subtask.version);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  useUnsavedChanges(editing, saving);
  const lock = useRef(false);
  const { captureFocus, handleCloseAutoFocus } = useFocusReturn();

  // 非编辑态时，让本行始终跟随远端最新值（onReload 后 subtask prop 会变化）。

  function begin() {
    if (!canEdit || disabled) return;
    setDraft(subtask.title);
    setBase(subtask.version);
    setEditing(true);
    setError(null);
    setConflict(false);
  }

  function cancel() {
    if (lock.current) return;
    setEditing(false);
    setConflict(false);
    setError(null);
    setDraft(subtask.title);
    setBase(subtask.version);
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
    const title = draft.trim();
    if (!title) {
      setError("标题不能为空。");
      return;
    }
    if (title.length > TITLE_MAX) {
      setError(`标题不能超过 ${TITLE_MAX} 个字符。`);
      return;
    }
    if (title === subtask.title) {
      cancel();
      return;
    }
    beginWrite();
    try {
      const res = await api.patch(`/subtasks/${subtask.id}`, SubtaskSchema, {
        expectedVersion: base,
        title,
      });
      if (!res.ok) {
        if (redirectToLoginIfUnauthenticated(res.status)) return;
        if (res.error.code === "VERSION_CONFLICT") {
          setConflict(true);
          await onReload();
        } else if (res.status === 404) {
          toast({ title: "子任务已被删除", variant: "info" });
          await onReload();
        } else {
          setError(
            messageForError(res.error.code, res.status, res.error.message),
          );
        }
        return;
      }
      toast({ title: "子任务已更新", variant: "success" });
      setEditing(false);
      setConflict(false);
      await onReload();
    } catch {
      setError("无法连接服务器，你的修改已保留，请重试。");
    } finally {
      endWrite();
    }
  }

  async function handleToggle() {
    if (lock.current || !canEdit || disabled) return;
    beginWrite();
    try {
      const res = await api.patch(`/subtasks/${subtask.id}`, SubtaskSchema, {
        expectedVersion: subtask.version,
        isCompleted: !subtask.isCompleted,
      });
      if (!res.ok) {
        if (redirectToLoginIfUnauthenticated(res.status)) return;
        if (res.error.code === "VERSION_CONFLICT") {
          toast({
            title: "该子任务已被他人更新",
            description: "已显示最新状态，请确认后再操作。",
            variant: "info",
          });
          await onReload();
        } else if (res.status === 404) {
          await onReload();
        } else {
          toast({
            title: messageForError(
              res.error.code,
              res.status,
              "更新失败，请重试。",
            ),
            variant: "danger",
          });
        }
        return;
      }
      await onReload();
    } catch {
      toast({ title: "无法连接服务器，请稍后重试。", variant: "danger" });
    } finally {
      endWrite();
    }
  }

  async function handleDelete() {
    if (lock.current) return;
    beginWrite();
    try {
      const res = await apiDelete(`/subtasks/${subtask.id}`, {
        expectedVersion: subtask.version,
      });
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
      toast({ title: "子任务已删除", variant: "success" });
      await onReload();
    } catch {
      setError("无法连接服务器，请稍后重试。");
    } finally {
      endWrite();
    }
  }

  return (
    <li className="group/row flex items-start gap-2 rounded-control border border-transparent p-2 transition-colors hover:bg-surface-sunken">
      <button
        type="button"
        onClick={handleToggle}
        disabled={!canEdit || disabled || saving}
        aria-label={subtask.isCompleted ? "标记为未完成" : "标记为完成"}
        aria-pressed={subtask.isCompleted}
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border outline-none transition-all",
          subtask.isCompleted
            ? "border-success bg-success text-foreground-invert"
            : "border-line-strong hover:border-brand",
          !canEdit || disabled
            ? "cursor-not-allowed opacity-50"
            : "cursor-pointer",
          saving && "pointer-events-none opacity-70",
        )}
      >
        {subtask.isCompleted && (
          <Check className="h-3 w-3" aria-hidden="true" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
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
                  if (draft !== subtask.title && !window.confirm("确定放弃当前子任务修改？")) {
                    return;
                  }
                  cancel();
                } else if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSave();
                }
              }}
              aria-label="编辑子任务标题"
              className="md:text-label"
              rows={2}
              maxLength={TITLE_MAX}
              autoFocus
            />
            {conflict && (
              <div
                role="alert"
                className="space-y-2 rounded-control border border-line bg-surface-sunken p-2 text-caption"
              >
                <p className="font-medium text-foreground">
                  该子任务已被他人更新（版本 {subtask.version}）
                </p>
                <p className="text-foreground-secondary [overflow-wrap:anywhere]">
                  远端当前标题：{subtask.title}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={saving}
                    onClick={() => {
                      setDraft(subtask.title);
                      setBase(subtask.version);
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
                      setBase(subtask.version);
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
                disabled={saving || conflict || !draft.trim()}
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
          <div className="flex items-start gap-2">
            <span
              className={cn(
                "flex-1 break-all text-label [overflow-wrap:anywhere]",
                subtask.isCompleted
                  ? "text-foreground-muted line-through"
                  : "text-foreground",
              )}
              onDoubleClick={begin}
              title={canEdit ? "双击编辑" : undefined}
            >
              {subtask.title}
            </span>
            {canEdit && (
              <span className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 focus-within:opacity-100 group-hover/row:opacity-100">
                <IconButton
                  label="编辑子任务"
                  size="sm"
                  onClick={begin}
                  disabled={disabled}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton
                  label="删除子任务"
                  size="sm"
                  onClick={() => {
                    captureFocus();
                    setError(null);
                    setDeleteOpen(true);
                  }}
                  disabled={disabled}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </span>
            )}
          </div>
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
            <DialogTitle>删除子任务？</DialogTitle>
            <DialogDescription>
              「{subtask.title}」将被删除，此操作无法撤销。
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
