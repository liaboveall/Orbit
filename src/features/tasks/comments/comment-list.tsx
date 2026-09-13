"use client";
import { useUnsavedChanges } from "../unsaved-changes";
import { useRouter } from "next/navigation";
import { useResourceRefresh } from "../use-resource-refresh";

import { MessageSquare } from "lucide-react";
import { useCallback, useRef, useState } from "react";
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
import { ErrorPanel } from "@/features/shell/state-views";
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
 * 已读到末尾时显示新评论；仍有后续页时保留阅读窗口并提示继续加载。
 *
 * 六态：loading（骨架）/ empty（空提示）/ error（局部错误+重试）/ permission（403）/ 正常 /
 * long-content（列表天然可滚动，分页避免一次性渲染过多）。
 */
export function CommentList({
  taskId,
  revision,
  currentUserId,
  isProjectOwner,
  canWrite,
}: {
  taskId: string;
  revision?: string;
  currentUserId: string;
  /** 当前用户是否为项目 OWNER（可删除任意评论）。 */
  isProjectOwner: boolean;
  /** 项目可写（未归档且为成员），决定是否显示发布/编辑入口。 */
  canWrite: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [comments, setComments] = useState<CommentDTO[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rowBusy, setRowBusy] = useState(false);
  const [postedOutsideWindow, setPostedOutsideWindow] = useState(false);

  const [draft, setDraft] = useState("");
  const [postError, setPostError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const postLock = useRef(false);
  const submission = useRef<{ body: string; key: string } | null>(null);
  const pages = useRef(1);
  useUnsavedChanges(draft.length > 0, posting);
  const generation = useRef(0);
  const pagination = useRef<Promise<void> | null>(null);

  /** 从头刷新已加载的页数（也用于冲突/删除后的刷新）。 */
  const load = useCallback(async () => {
    // A focus/RSC refresh must not discard a pagination click. Wait for that
    // page to settle, then refresh the expanded window with its new page count.
    if (pagination.current) await pagination.current;
    const epoch = ++generation.current;
    try {
      let next: string | undefined,
        more = false,
        page = 0;
      const rows: CommentDTO[] = [];
      do {
        const res = await api.getList(
          `/tasks/${taskId}/comments`,
          CommentSchema,
          { query: { limit: PAGE_LIMIT, cursor: next } },
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
            messageForError(
              res.error.code,
              res.status,
              "加载评论失败，请重试。",
            ),
          );
          return;
        }
        rows.push(...res.data);
        next = res.meta.nextCursor ?? undefined;
        more = res.meta.hasMore;
        page++;
      } while (more && next && page < pages.current);
      pages.current = page;
      setComments(
        [...new Map(rows.map((row) => [row.id, row])).values()].sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        ),
      );
      setCursor(next ?? null);
      setHasMore(more);
      if (!more) setPostedOutsideWindow(false);
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

  async function handleLoadMore() {
    if (pagination.current || !cursor) return;
    let settled!: () => void;
    pagination.current = new Promise<void>(resolve => { settled = resolve; });
    setLoadingMore(true);
    const epoch = ++generation.current;
    try {
      const res = await api.getList(`/tasks/${taskId}/comments`, CommentSchema, {
        query: { limit: PAGE_LIMIT, cursor },
      });
      if (epoch !== generation.current) return;
      if (!res.ok) {
        if (redirectToLoginIfUnauthenticated(res.status)) return;
        if (res.status === 403 || res.status === 404) {
          setForbidden(true);
          router.refresh();
          return;
        }
        setLoadError(messageForError(res.error.code, res.status, "加载评论失败，请重试。"));
        return;
      }
      pages.current++;
      setComments((previous) => [...new Map([...(previous ?? []), ...res.data].map((row) => [row.id, row])).values()]);
      setCursor(res.meta.nextCursor ?? null);
      setHasMore(res.meta.hasMore);
      if (!res.meta.hasMore) setPostedOutsideWindow(false);
      setLoadError(null);
    } catch {
      toast({ title: "无法连接服务器，请稍后重试。", variant: "danger" });
    } finally {
      pagination.current = null;
      settled();
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
    const body = JSON.stringify(parsed.data);
    if (submission.current?.body !== body)
      submission.current = { body, key: crypto.randomUUID() };
    try {
      const res = await api.post(
        `/tasks/${taskId}/comments`,
        CommentSchema,
        parsed.data,
        {
          idempotencyKey: submission.current.key,
        },
      );
      if (!res.ok) {
        if (redirectToLoginIfUnauthenticated(res.status)) return;
        setPostError(
          messageForError(res.error.code, res.status, res.error.message),
        );
        return;
      }
      // Preserve the reader's loaded window; never fetch the entire discussion on post.
      // If already at its end, allow one extra page for the newly created row.
      if (!hasMore) pages.current++;
      else setPostedOutsideWindow(true);
      await load();
      submission.current = null;
      setDraft("");
      router.refresh();
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
        <MessageSquare
          className="h-4 w-4 text-foreground-muted"
          aria-hidden="true"
        />
        评论{total > 0 ? ` (${total}${hasMore ? "+" : ""})` : ""}
      </h2>

      {comments === null && !loadError && !forbidden ? (
        <SkeletonBlock label="评论加载中" className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </SkeletonBlock>
      ) : forbidden ? (
        <p className="text-caption text-foreground-muted">
          你没有查看该任务评论的权限。
        </p>
      ) : loadError && comments === null ? (
        // F24 修复：单一明确重试动作（ErrorPanel onRetry），不再出现样例 toast 按钮。
        <ErrorPanel
          message={loadError}
          draftNote="你已输入的评论草稿已保留。"
          onRetry={() => {
            setLoadError(null);
            setComments(null);
            void load();
          }}
        />
      ) : (
        <>
          {loadError && <div role="alert"><InlineError>{loadError}</InlineError><Button size="sm" variant="secondary" onClick={() => void load()}>重新加载</Button></div>}
          {total === 0 ? (
            <p className="text-caption text-foreground-muted">
              还没有评论，来说点什么吧。
            </p>
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
                  onReload={changed}
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
          {postedOutsideWindow && <p role="status" className="text-caption text-foreground-secondary">评论已发布到讨论末尾，可继续加载更多评论查看。</p>}
          <Textarea
            value={draft}
            disabled={posting}
            onChange={(e) => {
              setDraft(e.target.value);
              setPostError(null);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
                e.stopPropagation();
                return;
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                // F21 修复：有草稿时 Escape 需确认才清空（与详情关闭/嵌套 Escape 一致）；
                // IME 组合输入已在上方短路，不会误触。取消（不确认）可继续编辑。
                if (draft.length === 0) return;
                if (window.confirm("确定放弃当前评论草稿？")) {
                  setDraft("");
                  setPostError(null);
                }
              }
            }}
            placeholder="发表评论（纯文本，最多 2000 字符）…"
            aria-label="评论正文"
            className="md:text-label"
            rows={3}
            maxLength={BODY_MAX}
          />
          {postError && <InlineError>{postError}</InlineError>}
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-caption text-foreground-muted">
              {draft.length}/{BODY_MAX} · 纯文本，脚本不会执行
            </p>
            <Button
              size="sm"
              onClick={handlePost}
              disabled={posting || !draft.trim()}
            >
              {posting ? "发布中…" : "发表评论"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
