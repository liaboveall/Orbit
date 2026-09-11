"use client";

import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  InlineError,
  Skeleton,
  SkeletonBlock,
  Textarea,
  useToast,
} from "@/components/ui";
import {
  CommentSchema,
  CreateCommentSchema,
  createApiClient,
  type CommentDTO,
} from "@/contracts";
import { SampleError } from "@/features/shell/state-views";
import {
  messageForError,
  redirectToLoginIfUnauthenticated,
} from "../api-helpers";
import { CommentItem } from "./comment-item";

const api = createApiClient();
const BODY_MAX = 2000;
const PAGE_LIMIT = 30;

/**
 * 评论模块容器（ORB-017）。自取数据：分页读取 GET /tasks/{id}/comments（游标分页，每页 30 条），
 * 「加载更多」按 nextCursor 追加；发布走 POST（幂等键）。评论按返回顺序（时间正序）渲染，
 * 新发布的评论追加到列表末尾（贴近底部输入框的时间流阅读顺序）。
 *
 * 六态：loading（骨架）/ empty（空提示）/ error（局部错误+重试）/ permission（403）/ 正常 /
 * long-content（列表天然可滚动，分页避免一次性渲染过多）。
 */
export function CommentList({
  taskId,
  currentUserId,
  isProjectOwner,
  canWrite,
}: {
  taskId: string;
  currentUserId: string;
  /** 当前用户是否为项目 OWNER（可删除任意评论）。 */
  isProjectOwner: boolean;
  /** 项目可写（未归档且为成员），决定是否显示发布/编辑入口。 */
  canWrite: boolean;
}) {
  const { toast } = useToast();
  const [comments, setComments] = useState<CommentDTO[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rowBusy, setRowBusy] = useState(false);

  const [draft, setDraft] = useState("");
  const [postError, setPostError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const postLock = useRef(false);

  /** 从头加载第一页（也用于冲突/删除后的刷新）。 */
  const load = useCallback(async () => {
    try {
      const res = await api.getList(`/tasks/${taskId}/comments`, CommentSchema, {
        query: { limit: PAGE_LIMIT },
      });
      if (!res.ok) {
        if (redirectToLoginIfUnauthenticated(res.status)) return;
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        setLoadError(messageForError(res.error.code, res.status, "加载评论失败，请重试。"));
        return;
      }
      setComments(res.data);
      setCursor(res.meta.nextCursor);
      setHasMore(res.meta.hasMore);
      setLoadError(null);
      setForbidden(false);
    } catch {
      setLoadError("无法连接服务器，请检查网络后重试。");
    }
  }, [taskId]);

  useEffect(() => {
    setComments(null);
    setCursor(null);
    setHasMore(false);
    setLoadError(null);
    setForbidden(false);
    void load();
  }, [load]);

  async function handleLoadMore() {
    if (loadingMore || !cursor) return;
    setLoadingMore(true);
    try {
      const res = await api.getList(`/tasks/${taskId}/comments`, CommentSchema, {
        query: { limit: PAGE_LIMIT, cursor },
      });
      if (!res.ok) {
        if (redirectToLoginIfUnauthenticated(res.status)) return;
        toast({
          title: messageForError(res.error.code, res.status, "加载更多评论失败，请重试。"),
          variant: "danger",
        });
        return;
      }
      setComments((prev) => [...(prev ?? []), ...res.data]);
      setCursor(res.meta.nextCursor);
      setHasMore(res.meta.hasMore);
    } catch {
      toast({ title: "无法连接服务器，请稍后重试。", variant: "danger" });
    } finally {
      setLoadingMore(false);
    }
  }

  async function handlePost() {
    if (postLock.current || !canWrite) return;
    const parsed = CreateCommentSchema.safeParse({ body: draft.trim() });
    if (!parsed.success) {
      // Zod 4：读取 .issues（非 Zod 3 的 .errors）。
      setPostError(parsed.error.issues[0]?.message ?? "评论内容不合法。");
      return;
    }
    postLock.current = true;
    setPosting(true);
    setPostError(null);
    try {
      const res = await api.post(`/tasks/${taskId}/comments`, CommentSchema, parsed.data, {
        idempotencyKey: crypto.randomUUID(),
      });
      if (!res.ok) {
        if (redirectToLoginIfUnauthenticated(res.status)) return;
        setPostError(messageForError(res.error.code, res.status, res.error.message));
        return;
      }
      // 时间正序：新评论追加到末尾。
      setComments((prev) => [...(prev ?? []), res.data]);
      setDraft("");
      toast({ title: "评论已发布", variant: "success" });
    } catch {
      setPostError("无法连接服务器，你的输入已保留，请重试。");
    } finally {
      postLock.current = false;
      setPosting(false);
    }
  }

  const total = comments?.length ?? 0;

  return (
    <section className="space-y-4" aria-label="评论">
      <h2 className="flex items-center gap-2 text-label font-semibold text-foreground">
        <MessageSquare className="h-4 w-4 text-foreground-muted" aria-hidden="true" />
        评论{total > 0 ? ` (${total}${hasMore ? "+" : ""})` : ""}
      </h2>

      {comments === null && !loadError ? (
        <SkeletonBlock label="评论加载中" className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </SkeletonBlock>
      ) : forbidden ? (
        <p className="text-caption text-foreground-muted">你没有查看该任务评论的权限。</p>
      ) : loadError ? (
        <div>
          <SampleError message={loadError} draftNote={null} />
          <div className="mt-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setLoadError(null);
                setComments(null);
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
            <p className="text-caption text-foreground-muted">还没有评论，来说点什么吧。</p>
          ) : (
            <ul className="space-y-2" role="list">
              {comments!.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  currentUserId={currentUserId}
                  isProjectOwner={isProjectOwner}
                  canWrite={canWrite}
                  disabled={rowBusy}
                  onBusyChange={setRowBusy}
                  onReload={load}
                />
              ))}
            </ul>
          )}

          {hasMore && (
            <div className="flex justify-center">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "加载中…" : "加载更多评论"}
              </Button>
            </div>
          )}
        </>
      )}

      {canWrite && (
        <div className="rounded-control border border-line p-3">
          <Textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setPostError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setDraft("");
                setPostError(null);
              }
            }}
            placeholder="发表评论（纯文本，最多 2000 字符）…"
            aria-label="评论正文"
            className="text-label"
            rows={3}
            maxLength={BODY_MAX}
          />
          {postError && <InlineError>{postError}</InlineError>}
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-caption text-foreground-muted">
              {draft.length}/{BODY_MAX} · 纯文本，脚本不会执行
            </p>
            <Button size="sm" onClick={handlePost} disabled={posting || !draft.trim()}>
              {posting ? "发布中…" : "发表评论"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
