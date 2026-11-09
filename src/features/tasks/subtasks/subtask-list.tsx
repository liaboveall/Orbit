"use client";
import { useUnsavedChanges } from "../unsaved-changes";
import { useRouter } from "next/navigation";
import { useRetainedEditors, type RetainedRow } from "../retained-editors";
import { useResourceRefresh } from "../use-resource-refresh";

import { ListChecks, Plus } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { z } from "zod";
import {
  Button,
  InlineError,
  Skeleton,
  SkeletonBlock,
  Textarea,
  useToast,
} from "@/components/ui";
import {
  CreateSubtaskSchema,
  SubtaskSchema,
  createApiClient,
  type SubtaskDTO,
} from "@/contracts";
import { ErrorPanel } from "@/features/shell/state-views";
import {
  messageForError,
  redirectToLoginIfUnauthenticated,
} from "../api-helpers";
import { SubtaskItem } from "./subtask-item";

const api = createApiClient();
const SubtaskListSchema = z.array(SubtaskSchema);
const TITLE_MAX = 200;

/**
 * 子任务模块容器（ORB-016）。自取数据（GET /tasks/{id}/subtasks，非分页 → api.get + 数组 schema），
 * 负责添加（POST 幂等）与刷新，勾选/编辑/删除由 SubtaskItem 直接对接端点。
 *
 * 六态：loading（骨架）/ empty（空提示）/ error（局部错误+重试，不清草稿）/ permission（403）
 * / 正常 / long-content（列表天然可滚动）。移动端布局在 task-editor 容器内自适应。
 */
export function SubtaskList({
  taskId,
  canEdit,
  revision,
}: {
  taskId: string;
  canEdit: boolean;
  revision?: string;
}) {
  const router = useRouter();
  const { onEditingChange, retain } = useRetainedEditors<SubtaskDTO>();
  const { toast } = useToast();
  const [subtasks, setSubtasks] = useState<RetainedRow<SubtaskDTO>[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [rowBusy, setRowBusy] = useState(false);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const addLock = useRef(false);
  const submission = useRef<{ body: string; key: string } | null>(null);

  useUnsavedChanges(draft.length > 0, submitting);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const epoch = ++generation.current;
    try {
      const res = await api.get(`/tasks/${taskId}/subtasks`, SubtaskListSchema);
      if (epoch !== generation.current) return;
      if (!res.ok) {
        if (redirectToLoginIfUnauthenticated(res.status)) return;
        if (res.status === 403 || res.status === 404) {
          setForbidden(true);
          router.refresh();
          return;
        }
        setLoadError(
          messageForError(
            res.error.code,
            res.status,
            "加载子任务失败，请重试。",
          ),
        );
        return;
      }
      setSubtasks(previous => retain(previous, res.data));
      setLoadError(null);
      setForbidden(false);
    } catch {
      if (epoch !== generation.current) return;
      setLoadError("无法连接服务器，请检查网络后重试。");
    }
  }, [taskId, router, retain]);

  useResourceRefresh(load, revision);
  const changed = async () => {
    await load();
    router.refresh();
  };

  async function handleAdd() {
    if (addLock.current || !canEdit || forbidden) return;
    const parsed = CreateSubtaskSchema.safeParse({ title: draft.trim() });
    if (!parsed.success) {
      // Zod 4：读取 .issues（非 Zod 3 的 .errors）。
      setAddError(parsed.error.issues[0]?.message ?? "标题不合法。");
      return;
    }
    addLock.current = true;
    setSubmitting(true);
    setAddError(null);
    const body = JSON.stringify(parsed.data);
    if (submission.current?.body !== body)
      submission.current = { body, key: crypto.randomUUID() };
    try {
      const res = await api.post(
        `/tasks/${taskId}/subtasks`,
        SubtaskSchema,
        parsed.data,
        {
          idempotencyKey: submission.current.key,
        },
      );
      if (!res.ok) {
        if (redirectToLoginIfUnauthenticated(res.status)) return;
        setAddError(
          messageForError(res.error.code, res.status, res.error.message),
        );
        return;
      }
      submission.current = null;
      setDraft("");
      router.refresh();
      setAdding(false);
      toast({ title: "子任务已添加", variant: "success" });
      await load();
    } catch {
      setAddError("无法连接服务器，你的输入已保留，请重试。");
    } finally {
      addLock.current = false;
      setSubmitting(false);
    }
  }

  const doneCount = subtasks?.filter((s) => !s.unavailable && s.isCompleted).length ?? 0;
  const total = subtasks?.filter(s => !s.unavailable).length ?? 0;

  return (
    <section className="space-y-3" aria-label="子任务">
      {forbidden && <p role="status">任务已不可用，未保存的内容仅供复制。</p>}
      <h2 className="flex items-center gap-2 text-label font-semibold text-foreground">
        <ListChecks
          className="h-4 w-4 text-foreground-muted"
          aria-hidden="true"
        />
        子任务{total > 0 ? ` (${doneCount}/${total})` : ""}
      </h2>

      {subtasks === null && !loadError && !forbidden ? (
        <SkeletonBlock label="子任务加载中" className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </SkeletonBlock>
      ) : forbidden && subtasks === null ? (
        <p className="text-caption text-foreground-muted">
          你没有查看该任务子任务的权限。
        </p>
      ) : loadError && subtasks === null ? (
        // F24 修复：单一明确重试动作。
        <ErrorPanel
          message={loadError}
          onRetry={() => {
            setLoadError(null);
            setSubtasks(null);
            void load();
          }}
        />
      ) : (
        <>
          {loadError && <div role="alert"><InlineError>{loadError}</InlineError><Button size="sm" variant="secondary" onClick={() => void load()}>重新加载</Button></div>}
          {total === 0 && !adding && !subtasks?.some(s => s.unavailable) ? (
            <p className="text-caption text-foreground-muted">暂无子任务。</p>
          ) : (
            <ul className="-mx-2 space-y-0.5" role="list">
              {(subtasks ?? []).map((subtask) => (
                <SubtaskItem
                  key={subtask.id}
                  subtask={subtask}
                  canEdit={canEdit && !forbidden && !subtask.unavailable}
                  unavailable={subtask.unavailable}
                  onEditingChange={onEditingChange}
                  disabled={rowBusy}
                  onBusyChange={setRowBusy}
                  onReload={changed}
                />
              ))}
            </ul>
          )}

          {(canEdit || draft.length > 0) && (
            <div>
              {adding ? (
                <div className="space-y-2">
                  <Textarea
                    value={draft}
                    disabled={submitting}
                    readOnly={!canEdit || forbidden}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setAddError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
                        e.stopPropagation();
                        return;
                      }
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        if (draft.length > 0 && !window.confirm("确定放弃当前子任务草稿？")) {
                          return;
                        }
                        setAdding(false);
                        setDraft("");
                        setAddError(null);
                      } else if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleAdd();
                      }
                    }}
                    placeholder="输入子任务标题（最多 200 字符）…"
                    aria-label="新子任务标题"
                    className="md:text-label"
                    rows={2}
                    maxLength={TITLE_MAX}
                    autoFocus
                  />
                  {addError && <InlineError>{addError}</InlineError>}
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={handleAdd}
                      disabled={submitting || !canEdit || forbidden || !draft.trim()}
                    >
                      {submitting ? "添加中…" : "添加"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={submitting}
                      onClick={() => {
                        setAdding(false);
                        setDraft("");
                        setAddError(null);
                      }}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAdding(true);
                    setAddError(null);
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  添加子任务
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
