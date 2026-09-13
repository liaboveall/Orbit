"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { loginPathWithReturnTo as _loginPathWithReturnTo } from "@/lib/return-to";
import { useAutoRefresh } from "@/features/tasks/real/use-auto-refresh";
import { usePermissionLossHandler, PermissionLossOverlay } from "@/features/activity/use-permission-loss-handler";
import { formatEventDateTime, useUserTimezone } from "@/lib/user-timezone";

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

// F23 修复：活动时间改用账户时区（formatEventDateTime），不再用设备时区。

/** ISO → 相对时间（挂载后用）。 */
function formatRelative(iso: string, tz: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  if (diff < 0) return formatEventDateTime(iso, tz);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatEventDateTime(iso, tz);
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

/** 按 id 去重（保留先出现者的顺序位置），用于合并首屏与追加分页时防止重复条目。 */
function dedupeById(items: ActivityDTO[]): ActivityDTO[] {
  const seen = new Set<string>();
  const result: ActivityDTO[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
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
  const _router = useRouter(); // legacy, now using permission loss handler
  // 数据真源是 Server Component 传入的 initialActivities props：router.refresh()
  // 之后会带来新的 props 引用（后台刷新命中新数据时 initialActivities 的引用与内容都会
  // 变化）。此前只有「加载更多」追加的 extraActivities 是 state，首屏本身从未随新 props
  // 重新合并——导致 focus/轮询触发的 refresh 请求即使成功拿到新活动，页面仍停在挂载时的
  // 旧首屏快照（A05 审查报告）。
  //
  // 修复：不再用 initialActivities 作初始值后放手不管，而是把它当作每次渲染都要参与
  // 合并的权威基线；「加载更多」产生的追加页单独存 state，只有当 initialActivities 的
  // 引用变化（即一次新的 refresh 帧）时才在渲染期间同步丢弃/重建追加页，按 id 去重，
  // 避免旧分页请求的响应在 refresh 之后延迟落地时把已被替换的首屏数据重新拼回来。
  const [baseActivities, setBaseActivities] = useState(initialActivities);
  const [baseCursor, setBaseCursor] = useState(initialCursor);
  const [baseHasMore, setBaseHasMore] = useState(initialHasMore);
  const [extraActivities, setExtraActivities] = useState<ActivityDTO[]>([]);
  const [extraCursor, setExtraCursor] = useState<string | null>(null);
  const [extraHasMore, setExtraHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();

  // 代次（generation）：每当 initialActivities 引用变化（新一轮 refresh/挂载）就自增，
  // 用 useRef 而非 state ——它只作为“当前请求是否仍然有效”的判据，本身不需要触发渲染。
  // 「加载更多」发起时把当前代次拍进闭包；响应落地时与 ref 的最新值比对，不相等即说明
  // 这是一个在其飞行期间已被新首屏取代的旧请求，必须整体丢弃（不更新 activities/cursor/
  // hasMore/error/pending 中的任何一项），而不是继续 dedupe-by-id 后拼接——
  // 旧响应可能来自完全不同的 project/筛选上下文，其中的 id 在新基线里从未出现过，
  // dedupe 无法识别这种「看起来是新数据、实际是错误上下文」的污染。
  const generationRef = useRef(0);

  useEffect(() => {
    return () => {
      // 卸载时代次前移，任何仍在飞行的响应落地时都会被判定为过期，不会在已卸载组件上
      // 触发 setState（React 18+ 严格模式下 setState-on-unmounted 只是警告，但仍属污染）。
      generationRef.current += 1;
    };
  }, []);

  // React「渲染期间依据 props 变化调整 state」范式：initialActivities 引用变化即视为
  // 服务端已产出新的权威首屏（无论是 focus 刷新、30s 轮询还是导航重挂载），据此重置
  // 分页状态，防止旧「加载更多」追加页残留、也防止旧首屏 state 挡住新数据。
  const [prevInitialActivities, setPrevInitialActivities] = useState(initialActivities);
  if (prevInitialActivities !== initialActivities) {
    setPrevInitialActivities(initialActivities);
    setBaseActivities(initialActivities);
    setBaseCursor(initialCursor);
    setBaseHasMore(initialHasMore);
    setExtraActivities([]);
    setExtraCursor(null);
    setExtraHasMore(false);
    // 新首屏到达 = 新代次开始。任何仍在飞行、绑定着旧代次的 handleLoadMore 响应落地时
    // 都会发现自己的代次已不匹配，整体丢弃（见 generationRef 声明处的注释）——但正因为
    // 它的 finally 分支被禁止在那种情况下解除 pending（避免与本次重置产生竞争性的
    // 二次 setState），这里必须主动把 loadingMore 一并清零：否则一个仍在飞行的旧请求
    // 会让新代次永久停在「正在加载…」，因为已经没有任何代码路径会再把它设回 false。
    setLoadingMore(false);
  }

  // 代次前移不能写在渲染体内（react-hooks/refs 禁止渲染期读写 ref.current），移入
  // effect：initialActivities 引用变化 → 上面的渲染期块先重置分页 state → 提交 →
  // 本 effect 运行 generation++。此后任何绑定旧代次、仍在飞行的 handleLoadMore 响应
  // 落地时都会发现 generationRef.current 已前进而被整体丢弃，语义与渲染期自增一致。
  useEffect(() => {
    generationRef.current += 1;
  }, [initialActivities]);

  // 按 id 去重合并：首屏 + 追加页，防止旧分页响应在刷新后落地时产生重复条目。
  const activities =
    extraActivities.length > 0
      ? dedupeById([...baseActivities, ...extraActivities])
      : baseActivities;
  const cursor = extraActivities.length > 0 ? extraCursor : baseCursor;
  const hasMore = extraActivities.length > 0 ? extraHasMore : baseHasMore;

  const _activity_path = `/app/projects/${projectId}/activity`; // legacy path
    
  // R11: Background refresh every 30s + on focus/visibility change
  useAutoRefresh();
  
  // R11 Enhanced: Handle permission loss gracefully
  const tz = useUserTimezone(); // F23：账户时区。
  const {
    hasPermissionError,
    permissionLossReason,
    handlePermissionError,
    clearPermissionError,
    goToLogin,
    leaveProject,
  } = usePermissionLossHandler({
    projectId,
    onLoss: (reason) => {
      console.warn(`[ActivityFeed] User ${reason} from project`, { reason });
    },
  });

  async function handleLoadMore(): Promise<void> {
    if (loadingMore || !cursor) return;
    const requestGeneration = generationRef.current;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await api.getList(`/projects/${projectId}/activity`, ActivitySchema, {
        query: { cursor, limit: PAGE_SIZE },
      });
      // 代次校验：响应落地时若代次已前移（期间发生了新的 refresh/挂载/卸载），说明
      // 这个响应属于一个已失效的旧上下文，不得更新 activities/cursor/hasMore/error/
      // pending 中的任何一项——不仅是「不追加」，pending 也不能在这里被解除，否则
      // 会与「新一轮渲染已经把 loadingMore 重置」的时序产生竞争性的二次 setState。
      if (generationRef.current !== requestGeneration) return;
      if (result.ok) {
        setExtraActivities((prev) => [...prev, ...result.data]);
        setExtraCursor(result.meta.nextCursor);
        setExtraHasMore(result.meta.hasMore);
        return;
      }
      if (result.status === 401) {
        // F22：401 = 会话失效 → 引导重新登录（遮罩内主操作，不再自动强跳）。
        const error = new Error("Unauthorized - session expired");
        handlePermissionError(error, "expired");
        return;
      }
      if (result.status === 403) {
        // F22：403 = 已无权限/被移出 → 引导离开项目（不再走会重弹回的登录流程）。
        const error = new Error("Forbidden - insufficient permissions");
        handlePermissionError(error, "revoked");
        return;
      }
      setError(result.error.message);
    } catch (err) {
      if (generationRef.current !== requestGeneration) return;
      const errorMessage = err instanceof ApiClientError
        ? "无法连接服务器，请检查网络后重试。"
        : "加载活动失败，请稍后重试。";
      setError(errorMessage);
    } finally {
      if (generationRef.current === requestGeneration) setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-6">
        <p className="font-mono text-caption uppercase tracking-[0.18em] text-foreground-muted">
          项目动态
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
                title={formatEventDateTime(item.createdAt, tz)}
                className="mt-1 block text-caption text-foreground-muted"
              >
                {mounted ? formatRelative(item.createdAt, tz) : formatEventDateTime(item.createdAt, tz)}
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

      {/* 权限丢失恢复遮罩（F22：Dialog 焦点隔离，401/403 分流，无自动强跳） */}
      {hasPermissionError && permissionLossReason ? (
        <PermissionLossOverlay
          isVisible={hasPermissionError}
          reason={permissionLossReason}
          onDismiss={clearPermissionError}
          onGoToLogin={goToLogin}
          onLeaveProject={leaveProject}
        />
      ) : null}
    </div>
  );
}
