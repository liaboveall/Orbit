"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, X } from "lucide-react";
import { z } from "zod";
import { renderRestrictedMarkdown } from "@/lib/restricted-markdown";
import {
  createApiClient,
  TaskSchema,
  DeletedTaskSchema,
  TASK_STATUS,
  TASK_PRIORITY,
  type TaskDTO,
  type MemberDTO,
} from "@/contracts";
import {
  Button,
  Textarea,
  InlineError,
  IconButton,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  useToast,
  useFocusReturn,
} from "@/components/ui";
import { DueBadge } from "../priority-badge";
import { getDueMeta, STATUS_LABEL, PRIORITY_LABEL } from "../task-meta";
import { loginPathWithReturnTo } from "@/lib/return-to";

const api = createApiClient();
const DraftSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().optional(),
  description: z.string().optional(),
});
type Draft = z.infer<typeof DraftSchema>;
const fieldClass =
  "w-full rounded-control border border-line bg-surface px-3 py-2 text-label outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50";

export function TaskEditor({
  task: incoming,
  currentUserId,
  today,
  readOnly = false,
  canDelete = false,
  members = [],
  onClose,
  onDeleted,
}: {
  task: TaskDTO;
  currentUserId: string;
  today: string;
  readOnly?: boolean;
  canDelete?: boolean;
  members?: MemberDTO[];
  onClose?: () => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState({
    source: incoming,
    value: incoming,
  });
  if (snapshot.source !== incoming)
    setSnapshot({
      source: incoming,
      value:
        incoming.version >= snapshot.value.version ? incoming : snapshot.value,
    });
  const task = snapshot.value;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<"title" | "description" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [remoteConflict, setRemoteConflict] = useState<TaskDTO | null>(null);
  const { captureFocus, handleCloseAutoFocus } = useFocusReturn();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [closing, setClosing] = useState(false);
  const draftKey = `orbit:draft:${currentUserId}:${task.projectId}:${task.id}`;
  const dirty = Boolean(
    draft && (draft.title !== undefined || draft.description !== undefined),
  );
  function store(value: Draft | null) {
    try {
      if (value) localStorage.setItem(draftKey, JSON.stringify(value));
      else localStorage.removeItem(draftKey);
    } catch {
      /* Unavailable storage must not prevent editing. */
    }
  }
  function begin(field: "title" | "description") {
    if (readOnly || busy) return;
    if (!draft) {
      let recovered: Draft | null = null;
      try {
        const parsed = DraftSchema.safeParse(
          JSON.parse(localStorage.getItem(draftKey) ?? "null"),
        );
        if (parsed.success) recovered = parsed.data;
      } catch {
        /* Invalid local draft. */
      }
      setDraft(recovered ?? { expectedVersion: task.version });
    }
    setEditing(field);
    setError(null);
  }
  function edit(field: "title" | "description", value: string) {
    const next = {
      ...(draft ?? { expectedVersion: task.version }),
      [field]: value,
    };
    setDraft(next);
    store(next);
  }
  function discard() {
    setDraft(null);
    store(null);
    setEditing(null);
    setConflict(false);
    setRemoteConflict(null);
    setError(null);
  }
  async function mutate(body: Record<string, unknown>, isText = false) {
    if (lock.current || readOnly || (isText && conflict)) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.patch(`/tasks/${task.id}`, TaskSchema, body);
      if (!result.ok) {
        setError(result.error.message);
        setConflict(result.error.code === "VERSION_CONFLICT");
        setRemoteConflict(null);
        if (result.status === 401)
          window.location.assign(
            loginPathWithReturnTo(location.pathname + location.search),
          );
        if (result.status === 404) {
          discard();
          onDeleted?.();
          router.refresh();
        }
        return;
      }
      setSnapshot({ source: incoming, value: result.data });
      if (isText) discard();
      toast({ title: "已保存", variant: "success" });
      router.refresh();
    } catch {
      setError("无法连接服务器，输入已保留，请重试。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function reloadVersion(keepDraft = true) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const result = await api.get(`/tasks/${task.id}`, TaskSchema);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (draft && keepDraft) {
        // Keep the original version until the user has reviewed this snapshot.
        setRemoteConflict(result.data);
        setConflict(true);
      } else {
        setSnapshot({ source: incoming, value: result.data });
        setRemoteConflict(null);
        setConflict(false);
      }
      setError(null);
      toast({
        title: "已载入最新版本",
        description: "你的草稿仍保留，请核对后再保存。",
      });
    } catch {
      setError("无法获取最新版本，请重试。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function resolveConflict(keepDraft: boolean) {
    if (!remoteConflict || busy) return;
    setSnapshot({ source: incoming, value: remoteConflict });
    if (keepDraft && draft) {
      const next = { ...draft, expectedVersion: remoteConflict.version };
      setDraft(next);
      store(next);
    } else {
      discard();
    }
    setRemoteConflict(null);
    setConflict(false);
    setError(null);
  }
  async function remove() {
    if (lock.current || readOnly || !canDelete) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.delete(`/tasks/${task.id}`, DeletedTaskSchema, {
        query: { expectedVersion: task.version },
      });
      if (!result.ok) {
        setError(result.error.message);
        setConflict(result.error.code === "VERSION_CONFLICT");
        return;
      }
      discard();
      setDeleting(false);
      toast({ title: "任务已移至回收站" });
      if (onDeleted) onDeleted();
      else router.push(`/app/projects/${task.projectId}/tasks`);
      router.refresh();
    } catch {
      setError("删除失败，请检查网络后重试。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function close() {
    if (dirty) { captureFocus(); setClosing(true); }
    else onClose?.();
  }
  const inputTitle = draft?.title ?? task.title;
  const inputDescription = draft?.description ?? task.description;
  const controls = (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        disabled={busy || !dirty || conflict}
        onClick={() => void mutate(draft ?? {}, true)}
      >
        {busy ? "保存中..." : "保存"}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={discard}>
        取消
      </Button>
    </div>
  );
  return (
    <section
      className="space-y-5 p-4 sm:p-6"
      data-task-editing={dirty || undefined}
      data-task-saving={busy || undefined}
    >
      <header className="flex items-center justify-between border-b border-line pb-3">
        <span className="font-mono text-caption text-foreground-muted">
          {task.identifier}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `${location.origin}/app/projects/${task.projectId}/tasks/${task.id}`,
                );
                toast({ title: "链接已复制" });
              } catch {
                setError("无法复制，请从地址栏复制链接。");
              }
            }}
          >
            复制链接
          </Button>
          {!readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="更多操作" disabled={busy}>
                  <MoreHorizontal className="h-4 w-4" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => begin("title")}>
                  编辑标题
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={dirty}
                  onSelect={() =>
                    void mutate({
                      expectedVersion: task.version,
                      status: "DONE",
                    })
                  }
                >
                  标记为已完成
                </DropdownMenuItem>
                {canDelete && (
                  <DropdownMenuItem onSelect={() => setDeleting(true)}>
                    删除任务
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {onClose && (
            <IconButton label="关闭详情" disabled={busy} onClick={close}>
              <X className="h-4 w-4" />
            </IconButton>
          )}
        </div>
      </header>
      {readOnly && (
        <p className="text-caption text-foreground-muted">项目已归档 · 只读</p>
      )}
      <InlineError>{error}</InlineError>
      {conflict && (
        <div
          role="alert"
          className="space-y-2 rounded-card border border-line p-3"
        >
          <p>
            任务已被其他操作更新。草稿已保留，请载入最新版本后核对；再次保存会提交你的草稿字段。
          </p>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void reloadVersion()}
          >
            载入最新版本并保留草稿
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              discard();
              void reloadVersion(false);
            }}
          >
            放弃草稿
          </Button>
          {remoteConflict && (
            <div className="space-y-3 border-t border-line pt-3">
              <p className="font-medium">远端最新内容（版本 {remoteConflict.version}）</p>
              <div className="whitespace-pre-wrap break-words">
                <p>标题</p><p>{remoteConflict.title}</p>
                <p>描述</p><p>{remoteConflict.description || "（空）"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => resolveConflict(false)}>采用远端内容</Button>
                <Button disabled={busy} variant="secondary" onClick={() => resolveConflict(true)}>保留我的修改并重试</Button>
              </div>
            </div>
          )}
        </div>
      )}
      {editing === "title" ? (
        <div className="space-y-2">
          <Textarea
            aria-label="编辑标题"
            value={inputTitle}
            maxLength={120}
            disabled={busy}
            onChange={(e) => edit("title", e.target.value)}
            autoFocus
          />
          {controls}
        </div>
      ) : (
        <button
          className="block w-full text-left text-section font-semibold [overflow-wrap:anywhere]"
          disabled={readOnly || busy}
          onClick={() => begin("title")}
        >
          {task.title}
        </button>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-caption">
          状态
          <select
            aria-label="状态"
            className={fieldClass}
            value={task.status}
            disabled={readOnly || busy || dirty}
            onChange={(e) =>
              void mutate({
                expectedVersion: task.version,
                status: e.target.value,
              })
            }
          >
            {Object.values(TASK_STATUS).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-caption">
          优先级
          <select
            aria-label="优先级"
            className={fieldClass}
            value={task.priority}
            disabled={readOnly || busy || dirty}
            onChange={(e) =>
              void mutate({
                expectedVersion: task.version,
                priority: e.target.value,
              })
            }
          >
            {Object.values(TASK_PRIORITY).map((s) => (
              <option key={s} value={s}>
                {PRIORITY_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-caption">
          负责人
          <select
            aria-label="负责人"
            className={fieldClass}
            value={task.assignee?.id ?? ""}
            disabled={readOnly || busy || dirty}
            onChange={(e) =>
              void mutate({
                expectedVersion: task.version,
                assigneeId: e.target.value || null,
              })
            }
          >
            <option value="">未分配</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-caption">
          截止日
          <input
            aria-label="截止日"
            type="date"
            className={fieldClass}
            value={task.dueDate ?? ""}
            disabled={readOnly || busy || dirty}
            onChange={(e) =>
              void mutate({
                expectedVersion: task.version,
                dueDate: e.target.value || null,
              })
            }
          />
          <DueBadge meta={getDueMeta(task.dueDate, today, task.status)} />
        </label>
      </div>
      <div className="space-y-2">
        <h2 className="text-label font-medium">描述</h2>
        {editing === "description" ? (
          <>
            <Textarea
              aria-label="编辑描述"
              maxLength={10000}
              rows={8}
              value={inputDescription}
              disabled={busy}
              onChange={(e) => edit("description", e.target.value)}
              autoFocus
            />
            {controls}
          </>
        ) : (
          <div className="group relative">
            <div
              className="min-h-28 w-full rounded-card border border-line p-3 pr-9 text-label text-foreground-secondary [overflow-wrap:anywhere]"
              onClick={(event) => {
                // 链接自身可点击跳转，不触发进入编辑态（避免容器与链接的嵌套交互冲突）。
                if ((event.target as HTMLElement).closest("a")) return;
                begin("description");
              }}
            >
              {task.description ? (
                renderRestrictedMarkdown(task.description)
              ) : (
                <span className="text-foreground-muted">添加描述</span>
              )}
            </div>
            <button
              type="button"
              aria-label="编辑描述"
              className="absolute right-2 top-2 rounded-control p-1 text-foreground-muted opacity-0 outline-none transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
              disabled={readOnly || busy}
              onClick={() => begin("description")}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <Dialog
        open={deleting}
        onOpenChange={(open) => {
          if (!busy) setDeleting(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除任务？</DialogTitle>
            <DialogDescription>任务将移至回收站，可以恢复。</DialogDescription>
          </DialogHeader>
          <InlineError>{error}</InlineError>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setDeleting(false)}
            >
              取消
            </Button>
            <Button disabled={busy} onClick={() => void remove()}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent onCloseAutoFocus={handleCloseAutoFocus}>
          <DialogHeader>
            <DialogTitle>你有未保存的更改</DialogTitle>
            <DialogDescription>
              保留编辑以继续，或放弃更改后关闭。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setClosing(false)}>保留编辑</Button>
            <Button
              variant="ghost"
              onClick={() => {
                discard();
                setClosing(false);
                onClose?.();
              }}
            >
              放弃更改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
