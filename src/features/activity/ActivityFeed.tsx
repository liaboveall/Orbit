"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Activity as ActivityIcon } from "lucide-react";
import {
  ActivitySchema,
  ApiClientError,
  createApiClient,
  type ActivityDTO,
  type ActivityAction,
  type ActivityEntityType,
} from "@/contracts";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineError } from "@/components/ui/inline-error";
import { Spinner } from "@/features/auth/auth-form";
import { STATUS_LABEL } from "@/features/tasks/task-meta";
import { loginPathWithReturnTo } from "@/lib/return-to";
import { useAutoRefresh } from "@/features/tasks/real/use-auto-refresh";

/**
 * 项目活动时间线（M4 / ORB-011，`/app/projects/[id]/activity`）。
 *
 * 首屏 ActivityDTO[] 由 Server Component 直调 listActivities（limit 30，createdAt DESC）
 * 取得后经 props 传入；「加载更多」用契约层 api.getList 取下一页并追加（keyset 游标
 * 来自上一页 PageMeta.nextCursor）。
 *
 * 相对时间：为避免 SSR 与客户端 Date.now() 差异导致的 hydration 不一致，首屏（含服务端
 * 渲染）一律显示绝对时间，挂载后再切换为相对时间（mounted 标志）。
 *
 * 边界（features 层）：不导入 @/server / @/generated。
 */

const api = createApiClient();
const PAGE_SIZE = 30;

/** 动作 → 中文描述（docs/05 §9 全表 20 项）。 */
const ACTION_LABEL: Record<ActivityAction, string> = {
  PROJECT_CREATED: "创建了项目",
  PROJECT_UPDATED: "更新了项目信息",
  PROJECT_ARCHIVED: "归档了项目",
  PROJECT_RESTORED: "恢复了项目",
  MEMBER_JOINED: "加入了项目",
  MEMBER_LEFT: "离开了项目",
  MEMBER_REMOVED: "移除了成员",
  TASK_CREATED: "创建了任务",
  TASK_UPDATED: "更新了任务",
  TASK_MOVED: "移动了任务",
  TASK_DELETED: "删除了任务",
  TASK_RESTORED: "恢复了任务",
  SUBTASK_CREATED: "创建了子任务",
  SUBTASK_UPDATED: "更新了子任务",
  SUBTASK_DELETED: "删除了子任务",
  COMMENT_CREATED: "发表了评论",
  COMMENT_UPDATED: "编辑了评论",
  COMMENT_DELETED: "删除了评论",
  FILE_UPLOADED: "上传了附件",
  FILE_DELETED: "删除了附件",
};

/** 实体类型 → 中文标签（无 taskIdentifier 时作为兜底引用）。 */
const ENTITY_LABEL: Record<ActivityEntityType, string> = {
  PROJECT: "项目",
  MEMBER: "成员",
  TASK: "任务",
  SUBTASK: "子任务",
  COMMENT: "评论",
  ATTACHMENT: "附件",
};

/** ISO → 「2026年9月10日 14:03」（绝对时间，服务端/首屏用）。 */
function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** ISO → 相对时间（挂载后用）。 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  if (diff < 0) return formatDateTime(iso);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDateTime(iso);
}

/**
 * 挂载检测：用 useSyncExternalStore 而非 useState+useEffect，避免在 effect 内同步
 * setState 触发级联渲染（react-hooks/set-state-in-effect）。服务端快照恒为 false
 * （首屏绝对时间，杜绝 hydration 不一致），客户端快照为 true（切换相对时间）。
 */
const emptySubscribe = (): (() => void) => () => {};
const getMountedSnapshot = (): boolean => true;
const getServerMountedSnapshot = (): boolean => false;

function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    getMountedSnapshot,
    getServerMountedSnapshot,
  );
}

export type ActivityFeedProps = {
  projectId: string;
  initialActivities: ActivityDTO[];
  nextCursor: string | null;
  hasMore: boolean;
};

export function ActivityFeed({
  projectId,
  initialActivities,
  nextCursor: initialCursor,
  hasMore: initialHasMore,
}: ActivityFeedProps) {
  const router = useRouter();
  const [activities, setActivities] = useState<ActivityDTO[]>(initialActivities);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();

  const activityPath = `/app/projects/${projectId}/activity`;
  
  // R11: Background refresh every 30s + on focus/visibility change
  useAutoRefresh();

  async function handleLoadMore(): Promise<void> {
    if (loadingMore || !cursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await api.getList(`/projects/${projectId}/activity`, ActivitySchema, {
        query: { cursor, limit: PAGE_SIZE },
      });
      if (result.ok) {
        setActivities((prev) => [...prev, ...result.data]);
        setCursor(result.meta.nextCursor);
        setHasMore(result.meta.hasMore);
        return;
      }
      if (result.status === 401) {
        void router.push(loginPathWithReturnTo(activityPath));
        return;
      }
      setError(result.error.message);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? "无法连接服务器，请检查网络后重试。"
          : "加载活动失败，请稍后重试。",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-6">
        <p className="font-mono text-caption uppercase tracking-[0.18em] text-foreground-muted">
          activity · /api/v1/projects/{projectId}/activity
        </p>
        <h1 className="mt-1 text-page font-semibold tracking-tight text-foreground">
          项目活动
        </h1>
        <p className="mt-1.5 text-label text-foreground-secondary">
          项目内任务、成员与设置的变更记录，按时间倒序排列。
        </p>
      </header>

      <InlineError className="mb-4">{error}</InlineError>

      {activities.length === 0 ? (
        <EmptyState
          icon={<ActivityIcon className="h-6 w-6" />}
          title="暂无活动记录"
          description="创建任务、邀请成员或修改项目后，变更会记录在这里。"
        />
      ) : (
        <ol className="relative space-y-1 border-l border-line pl-6">
          {activities.map((item) => (
            <li key={item.id} className="relative py-3">
              <span
                className="absolute -left-[31px] top-4 flex h-3 w-3 items-center justify-center rounded-full border-2 border-surface bg-brand"
                aria-hidden="true"
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Avatar name={item.actor.name} size="sm" />
                <span className="text-label font-medium text-foreground">
                  {item.actor.name}
                </span>
                <span className="text-label text-foreground-secondary">
                  {ACTION_LABEL[item.action]}
                </span>
                {item.metadata.taskIdentifier ? (
                  <Badge className="font-mono">{item.metadata.taskIdentifier}</Badge>
                ) : (
                  <Badge tone="neutral">{ENTITY_LABEL[item.entityType]}</Badge>
                )}
                {item.action === "TASK_MOVED" &&
                item.metadata.fromStatus &&
                item.metadata.toStatus ? (
                  <span className="text-caption text-foreground-muted">
                    {STATUS_LABEL[item.metadata.fromStatus]} → {STATUS_LABEL[item.metadata.toStatus]}
                  </span>
                ) : null}
              </div>
              <time
                dateTime={item.createdAt}
                title={formatDateTime(item.createdAt)}
                className="mt-1 block text-caption text-foreground-muted"
              >
                {mounted ? formatRelative(item.createdAt) : formatDateTime(item.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      )}

      {hasMore ? (
        <div className="mt-6 flex justify-center">
          <Button
            type="button"
            variant="secondary"
            disabled={loadingMore}
            aria-busy={loadingMore || undefined}
            onClick={() => {
              void handleLoadMore();
            }}
          >
            {loadingMore ? <Spinner /> : null}
            <span>{loadingMore ? "正在加载…" : "加载更多"}</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
