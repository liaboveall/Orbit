"use client";

import {
  Check,
  Copy,
  Link as LinkIcon,
  MoreHorizontal,
  Paperclip,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import {
  AttachmentDTO,
  CommentDTO,
  SubtaskDTO,
  TaskDTO,
  TaskPriority,
  TaskStatus,
} from "@/contracts";
import { cn } from "@/lib/cn";
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  InlineError,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useFocusReturn,
  useToast,
} from "@/components/ui";
import { Spinner } from "../auth/auth-form"; // Import from auth-form
import { formatBytes, getDueMeta, PRIORITY_LABEL, STATUS_LABEL } from "./task-meta";
import { DueBadge, PriorityBadge } from "./priority-badge";


/**
 * 任务详情（ORB-002）：侧面板（桌面）与独立页（手机/直链）共用同一组件。
 *
 * docs/02 §5：内容顺序 标题 → 状态 → 优先级 → 负责人 → 截止日 → 描述 →
 * 子任务 → 附件 → 评论。标题/描述可进入编辑（保存/取消），有未保存更改时关闭弹
 * 「保留编辑 / 放弃更改」确认框。M0 不触发真实写请求——保存/编辑/复制均只弹 Toast。
 * ⚠️ 数据来自 fixture。
 */

export type TaskDetailProps = {
  task: TaskDTO;
  variant: "panel" | "page";
  projectId: string;
  currentUserId: string;
  onClose?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
};

export function TaskDetail({ task, variant, projectId, currentUserId, onClose, onCloseAutoFocus }: TaskDetailProps) {
  const { toast } = useToast();
  
  // TODO: M5 - Load real data for subtasks/comments/attachments
  const _subtasks: SubtaskDTO[] = []; 
  const _comments: CommentDTO[] = [];
  const _attachments: AttachmentDTO[] = [];
  const subtasks = _subtasks;
  const comments = _comments;
  const attachments = _attachments;
  
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(task.description);
  const [commentDraft, setCommentDraft] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 编程式打开的确认框：打开瞬间记录焦点，关闭后精确还给触发元素（docs/02：关闭后恢复焦点）。
  const { captureFocus, handleCloseAutoFocus } = useFocusReturn<HTMLButtonElement>();

  const dirty =
    (editingTitle && titleDraft !== task.title) ||
    (editingDesc && descDraft !== task.description);

  const due = getDueMeta(task.dueDate, "2026-09-09", status); // TODO: 传入 today 参数

  /** Fixture-only interaction. Real pages use real/task-editor.tsx. */
  function saveChanges() {
    setSaveError(null);setSaving(false);setEditingTitle(false);setEditingDesc(false);
    toast({title:"样例模式：未写入真实任务"});
  }

  /** 清除本地草稿 */
  function clearDrafts() {
    localStorage.removeItem(`orbit:draft:${currentUserId}:${projectId}:${task.id}`);
  }

  /** 加载本地草稿 */
  function loadDrafts() {
    const draftKey = `orbit:draft:${currentUserId}:${projectId}:${task.id}`;
    const draft = localStorage.getItem(draftKey);
    if (draft) {
      try {
        const { title, description } = JSON.parse(draft);
        if (title) setTitleDraft(title);
        if (description !== undefined) setDescDraft(description);
      } catch {}
    }
  }

  /** 保存草稿到本地 */
  function saveDraftToLocal() {
    const draft = {
      title: editingTitle ? titleDraft : undefined,
      description: editingDesc ? descDraft : undefined,
    };
    const validDraft = Object.values(draft).some(v => v !== undefined);
    if (validDraft) {
      localStorage.setItem(`orbit:draft:${currentUserId}:${projectId}:${task.id}`, JSON.stringify(draft));
    }
  }

  function requestClose() {
    if (dirty) {
      captureFocus();
      setConfirmOpen(true);
    } else onClose?.();
  }

  function discardAndClose() {
    setTitleDraft(task.title);
    setDescDraft(task.description);
    setEditingTitle(false);
    setEditingDesc(false);
    setConfirmOpen(false);
    clearDrafts();
    onClose?.();
  }

  /** 保留编辑：不清除草稿，保持当前状态 */
  function handleKeepEditing() {
    setConfirmOpen(false);
    // 不清除草稿，保持当前的编辑状态
    setTitleDraft(titleDraft); // 保持用户输入
    setDescDraft(descDraft);
  }

  async function copyLink() {
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/app/projects/${task.projectId}/tasks/${task.id}`
        : `/app/projects/${task.projectId}/tasks/${task.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "已复制任务链接", variant: "success" });
    } catch {
      toast({ title: "复制失败，请手动复制链接", variant: "danger" });
    }
  }

  const doneCount = subtasks.filter((s) => s.isCompleted).length;

  const content = (
    <div className="flex h-full flex-col">
      {/* 顶部：编号 / 复制链接 / 更多菜单 / 关闭 */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="font-mono text-label font-medium text-foreground-secondary">
          {task.identifier}
        </span>
        <PriorityBadge priority={priority} />
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="复制任务链接" size="sm" onClick={copyLink}>
            <LinkIcon className="h-4 w-4" />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="更多操作" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditingTitle(true)}>
                编辑标题
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={copyLink}>
                <Copy className="h-4 w-4" /> 复制链接
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setStatus("DONE");
                  toast({ title: "任务已标记为完成", variant: "success" });
                }}
              >
                <Check className="h-4 w-4" /> 标记为已完成
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-danger data-[highlighted]:bg-danger-soft data-[highlighted]:text-danger"
                onClick={() => toast({ title: "任务已删除", variant: "danger" })}
              >
                <Trash2 className="h-4 w-4" /> 删除任务
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {variant === "panel" ? (
            <IconButton label="关闭详情" size="sm" onClick={requestClose}>
              <X className="h-4 w-4" />
            </IconButton>
          ) : null}
        </div>
      </div>

      {/* 内容区：独立滚动 */}
      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        {/* 标题（可编辑） */}
        {editingTitle ? (
          <div className="space-y-2">
            <Textarea
              value={titleDraft}
              rows={2}
              onChange={(e) => {
                setTitleDraft(e.target.value);
                saveDraftToLocal(); // 自动保存草稿
              }}
              aria-label="编辑标题"
              className="text-section font-semibold"
            />
            <InlineError>{saveError}</InlineError>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={saveChanges}
                disabled={saving}
              >
                {saving ? <Spinner /> : null}
                <span>{saving ? "保存中..." : "保存"}</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTitleDraft(task.title);
                  setEditingTitle(false);
                }}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              loadDrafts(); // 打开时加载本地草稿
              setEditingTitle(true);
            }}
            className="block w-full rounded-control text-left text-section font-semibold text-foreground outline-none [overflow-wrap:anywhere] hover:bg-surface-sunken"
            title="点击进入编辑"
          >
            {task.title}
          </button>
        )}

        {/* 状态 / 优先级 / 负责人 / 截止日 */}
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="状态">
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as TaskStatus);
                toast({ title: "任务状态已更新", variant: "info" });
              }}
            >
              <SelectTrigger aria-label="状态">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="优先级">
            <Select
              value={priority}
              onValueChange={(v) => {
                setPriority(v as TaskPriority);
                toast({ title: "任务优先级已更新", variant: "info" });
              }}
            >
              <SelectTrigger aria-label="优先级">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="负责人">
            {task.assignee ? (
              <span className="flex items-center gap-2">
                <Avatar name={task.assignee.name} size="sm" />
                <span className="text-label text-foreground">
                  {task.assignee.name}
                </span>
              </span>
            ) : (
              <span className="text-label text-foreground-muted">未分配</span>
            )}
          </Field>

          <Field label="截止日">
            <DueBadge meta={due} className="text-label" />
          </Field>
        </dl>

        {/* 描述（可编辑） */}
        <Section title="描述">
          {editingDesc ? (
            <div className="space-y-2">
              <Textarea
                value={descDraft}
                rows={6}
                onChange={(e) => {
                  setDescDraft(e.target.value);
                  saveDraftToLocal(); // 自动保存草稿
                }}
                aria-label="编辑描述"
              />
              <InlineError>{saveError}</InlineError>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={saveChanges}
                  disabled={saving}
                >
                  {saving ? <Spinner /> : null}
                  <span>{saving ? "保存中..." : "保存"}</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDescDraft(task.description);
                    setEditingDesc(false);
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : task.description ? (
            <button
              type="button"
              onClick={() => {
                loadDrafts(); // 打开时加载本地草稿
                setEditingDesc(true);
              }}
              className="block w-full rounded-control p-2 text-left text-label text-foreground-secondary outline-none hover:bg-surface-sunken"
              title="点击进入编辑"
            >
              <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                {task.description}
              </span>
            </button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                loadDrafts(); // 打开时加载本地草稿
                setEditingDesc(true);
              }}
            >
              添加描述
            </Button>
          )}
        </Section>

        {/* 子任务 */}
        <Section title={`子任务${subtasks.length ? ` ${doneCount}/${subtasks.length}` : ""}`}>
          {subtasks.length === 0 ? (
            <p className="text-caption text-foreground-muted">暂无子任务。</p>
          ) : (
            <ul className="space-y-1.5">
              {subtasks.map((s) => (
                <li key={s.id} className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      s.isCompleted
                        ? "border-success bg-success text-foreground-invert"
                        : "border-line-strong",
                    )}
                    aria-hidden="true"
                  >
                    {s.isCompleted ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span
                    className={cn(
                      "text-label [overflow-wrap:anywhere]",
                      s.isCompleted
                        ? "text-foreground-muted line-through"
                        : "text-foreground",
                    )}
                  >
                    {s.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 附件 */}
        <Section title={`附件${attachments.length ? ` ${attachments.length}` : ""}`}>
          {attachments.length === 0 ? (
            <p className="text-caption text-foreground-muted">暂无附件。</p>
          ) : (
            <ul className="space-y-2">
              {attachments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-3 rounded-control border border-line p-2"
                >
                  <Paperclip
                    className="h-4 w-4 shrink-0 text-foreground-muted"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-label text-foreground [overflow-wrap:anywhere]">
                      {a.fileName}
                    </span>
                    <span className="block text-caption text-foreground-muted">
                      {a.uploader.name} ·{" "}
                      {a.sizeBytes != null
                        ? formatBytes(a.sizeBytes)
                        : formatBytes(a.declaredSizeBytes)}
                    </span>
                  </span>
                  <AttachmentState state={a.state} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 评论 */}
        <Section title={`评论${comments.length ? ` ${comments.length}` : ""}`}>
          <ul className="space-y-3">
            {comments.map((c) => (
              <li key={c.id} className="flex gap-2">
                <Avatar name={c.author.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-2 text-caption">
                    <span className="font-medium text-foreground">
                      {c.author.name}
                    </span>
                    <span className="text-foreground-muted">
                      {c.createdAt.slice(0, 10)}
                    </span>
                    {c.editedAt ? (
                      <span className="text-foreground-muted">已编辑</span>
                    ) : null}
                  </p>
                  {c.isDeleted || !c.body ? (
                    <p className="text-label text-foreground-muted italic">
                      该评论已删除
                    </p>
                  ) : (
                    <p className="text-label text-foreground-secondary [overflow-wrap:anywhere]">
                      {c.body}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-3 space-y-2">
            <Textarea
              rows={2}
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              placeholder="发表评论…"
              aria-label="发表评论"
            />
            <Button
              size="sm"
              onClick={() => {
                setCommentDraft("");
                toast({ title: "评论已发布", variant: "info" });
              }}
            >
              发表评论
            </Button>
          </div>
        </Section>
      </div>

      {/* 未保存更改确认：保留编辑 / 放弃更改 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent onEscapeKeyDown={(event) => {event.preventDefault(); setConfirmOpen(false);}} onCloseAutoFocus={handleCloseAutoFocus}>
          <DialogHeader>
            <DialogTitle>你有未保存的更改</DialogTitle>
            <DialogDescription>
              关闭前，请选择保留当前编辑继续修改，或放弃这些更改。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={handleKeepEditing}>
              保留编辑
            </Button>
            <Button variant="danger" onClick={discardAndClose}>
              放弃更改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  if (variant === "page") return content;

  // 所有面板退出入口共用草稿确认；关闭 URL 参数后由父级卸载。
  return (
    <Drawer 
      open 
      onOpenChange={(open) => { 
        if (!open) {
          // 只有当内层确认框未打开时才关闭抽屉
          if (confirmOpen) {
            // 确认框已打开，让 Dialog 自己处理
            return;
          }
          requestClose();
        }
      }}
    >
      <DrawerContent
        side="right"
        showCloseButton={false}
        className="w-full md:top-16 md:h-[calc(100dvh-4rem)] md:w-[600px]"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DrawerTitle className="sr-only">任务详情：{task.title}</DrawerTitle>
        <DrawerDescription>查看和编辑任务，关闭详情返回看板。</DrawerDescription>
        {content}
      </DrawerContent>
    </Drawer>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <dt className="text-caption font-medium text-foreground-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-label font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function AttachmentState({ state }: { state: AttachmentDTO["state"] }) {
  if (state === "READY")
    return (
      <span className="inline-flex items-center gap-1 text-caption text-success">
        <Check className="h-3.5 w-3.5" /> 就绪
      </span>
    );
  if (state === "UPLOADING")
    return (
      <span className="text-caption text-foreground-muted" role="status">
        上传中…
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-caption text-danger">
      <X className="h-3.5 w-3.5" /> 失败
    </span>
  );
}
