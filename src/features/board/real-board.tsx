"use client";

import { Fragment, memo, useCallback, useState, useRef, useEffect, useId, useLayoutEffect, useMemo, useSyncExternalStore, useTransition, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  defaultDropAnimationSideEffects,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus } from "lucide-react";
import {
  BoardSchema,
  MoveResultSchema,
  createApiClient,
  TASK_STATUS,
  type BoardDTO,
  type BoardColumnDTO,
  type BoardQueryDTO,
  type MemberDTO,
  type ProjectDTO,
  type TaskStatus,
  type TaskSummaryDTO,
} from "@/contracts";
import { Button, IconButton, InlineError, Segments } from "@/components/ui";
import { ItemTransition } from "@/components/ui/transitions";
import { useHotkey } from "@/components/ui/use-hotkey";
import { TaskCreateDialog } from "@/features/tasks/real/task-create-form";
import { TaskFilters } from "@/features/tasks/real/task-filters";
import { useTaskPanel } from "@/features/tasks/real/task-panel";
import { STATUS_LABEL, sameTaskSummary } from "@/features/tasks/task-meta";
import { StatusGlyph } from "@/features/tasks/status-glyph";
import { cn } from "@/lib/cn";
import { loginPathWithReturnTo } from "@/lib/return-to";
import { adoptSnapshot, initialBoardState, placeTask, settleTask, type BoardState } from "./board-state";
import { TaskCardFace } from "./task-card-face";
import { AnimatedNumber } from "@/components/ui/animated-number";

const api = createApiClient();
const mobileQuery = "(max-width: 767px)";
function subscribeMobile(callback: () => void) {
  const media = window.matchMedia(mobileQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const readMobile = () => window.matchMedia(mobileQuery).matches;
const serverMobile = () => false;

const goToLogin = () => window.location.assign(loginPathWithReturnTo(location.pathname + location.search));

/** 卡片再多，视图过渡要逐张量位置就不划算了；超过这个数量直接更新，不做位置动画。 */
const ANIMATED_CARD_LIMIT = 160;

/** 落位：浮层滑回卡片的新位置，期间原位保持占位的淡色。 */
const dropAnimation: DropAnimation = {
  duration: 280,
  easing: "cubic-bezier(0.32, 0.72, 0, 1)",
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.35" } } }),
};

/** 刷新后把每一列补读到刷新前已加载的长度，页面高度和滚动位置保持不变。 */
async function refillBoard(endpoint: string, query: BoardQueryDTO, first: BoardDTO, previous: BoardDTO, signal?: AbortSignal): Promise<BoardDTO> {
  let board = first;
  for (const old of previous.columns) {
    let column = board.columns.find((c) => c.status === old.status);
    while (column?.nextCursor && (old.nextCursor === null || column.items.length < old.items.length)) {
      const result = await api.get(endpoint, BoardSchema, { query: { ...query, status: column.status, cursor: column.nextCursor, limit: 100 }, signal });
      if (!result.ok) throw new Error(result.error.message);
      if (result.data.boardVersion !== board.boardVersion) throw new Error("看板在刷新期间发生变化，请重新加载。");
      const page = result.data.columns.find((c) => c.status === old.status);
      if (!page) throw new Error("看板响应缺少目标列。");
      column = { ...page, items: [...column.items, ...page.items] };
      const updated = column;
      board = { ...board, columns: board.columns.map((c) => c.status === old.status ? updated : c) };
    }
  }
  return board;
}

type MoveTask = (task: TaskSummaryDTO, status: TaskStatus, before: string | null, options?: { animate?: boolean }) => Promise<void>;

export function RealBoard({
  initial,
  project,
  members,
  query,
  today,
}: {
  initial: BoardDTO;
  project: ProjectDTO;
  members: MemberDTO[];
  query: BoardQueryDTO;
  today: string;
}) {
  const router = useRouter();
  const tabPrefix = useId();
  // dnd-kit 默认用模块级计数器生成无障碍说明的 id，服务端和浏览器数到的值不同。
  const dndId = useId();
  const isMobile = useSyncExternalStore(subscribeMobile, readMobile, serverMobile);
  const [, startTransition] = useTransition();
  const context = JSON.stringify([project.id, today, query]);
  const [state, setState] = useState<BoardState>(() => initialBoardState(initial, context));
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<TaskSummaryDTO | null>(null);
  // 移动在途或正在拖拽时先不采用同一视图的新快照：它可能读于移动提交之前，
  // 也不该在手里拖着卡片时重排。操作结束后的下一次渲染再处理。
  const settled = !busy && dragging === null;
  if (state.context !== context || (state.source !== initial && settled)) setState(adoptSnapshot(state, initial, context));
  const board = state.board;
  const refreshing = state.refill !== null;
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const queryKey = JSON.stringify(query);
  const endpoint = `/projects/${project.id}/board`;

  useEffect(() => {
    if (state.refill === null) return;
    const controller = new AbortController();
    const source = state.source;
    void refillBoard(endpoint, JSON.parse(queryKey) as BoardQueryDTO, source, state.refill, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setState((prev) => (prev.source === source ? { ...prev, board: value, refill: null } : prev));
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState((prev) => (prev.source === source ? { ...prev, refill: null } : prev));
        setError(reason instanceof Error ? reason.message : "刷新失败，请重试。");
      });
    return () => controller.abort();
  }, [state.refill, state.source, endpoint, queryKey]);

  // 收到过期快照：服务端此刻已有更新的版本，再读一次。
  useEffect(() => {
    if (state.stale > 0) startTransition(() => router.refresh());
  }, [state.stale, state.source, router]);

  /** 新建任务对话框：值是新任务的初始状态，null 表示关闭。 */
  const [creating, setCreating] = useState<TaskStatus | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; status: TaskStatus | null } | null>(null);
  /** 刚落位的卡片：闪一下，告诉用户它到了哪里。 */
  const [landed, setLanded] = useState<string | null>(null);
  // 手机用状态 tab 一次看一列，桌面保持三列。
  const [mobileStatus, setMobileStatus] = useState<TaskStatus>(query.status ?? "TODO");
  const selectedStatus = board.columns.some((column) => column.status === mobileStatus) ? mobileStatus : board.columns[0]?.status;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const filtered = Boolean(
    query.q || query.status || query.priority || query.assigneeId || query.unassigned || query.overdue,
  );
  const complete = board.columns.length === 3 && board.columns.every((c) => c.nextCursor === null);
  const writable = project.archivedAt === null;
  const canDrag = writable && !busy && !refreshing && !filtered && complete;
  const cardCount = board.columns.reduce((sum, column) => sum + column.items.length, 0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  useHotkey("n", () => setCreating("TODO"), writable && creating === null);

  /** 只在视图没变（同一份 source）时写入，过期的异步结果不落到新视图上。 */
  function commit(change: BoardDTO | ((current: BoardDTO) => BoardDTO), source = state.source) {
    if (!alive.current) return;
    setState((prev) =>
      prev.source === source ? { ...prev, board: typeof change === "function" ? change(prev.board) : change } : prev,
    );
  }
  /** 让服务端组件重读；新快照到达时由上面的 adoptSnapshot 合并进本地状态。 */
  function refresh() {
    startTransition(() => router.refresh());
  }
  async function fresh() {
    const source = state.source;
    const result = await api.get(endpoint, BoardSchema, { query });
    if (!result.ok) {
      if (result.status === 401) goToLogin();
      if (result.status === 404) router.refresh();
      throw new Error(result.error.message);
    }
    const refreshed = await refillBoard(endpoint, query, result.data, board);
    commit(refreshed, source);
    return refreshed;
  }
  async function load(status?: TaskStatus, all = false) {
    if (lock.current || refreshing) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const source = state.source;
    let next = board;
    try {
      for (const column of board.columns.filter((c) => !status || c.status === status)) {
        let cursor = column.nextCursor;
        while (cursor) {
          const result = await api.get(endpoint, BoardSchema, {
            query: { ...query, status: column.status, cursor, limit: 100 },
          });
          if (!result.ok) {
            if (result.status === 401) {
              goToLogin();
              return;
            }
            // 顺序集合或筛选集合在分页之间变化（BOARD_CONFLICT），或过滤指纹随日期失效
            // （INVALID_CURSOR）：旧页不可拼接，整体重新读取。
            if (result.error.code === "BOARD_CONFLICT" || result.error.code === "INVALID_CURSOR") {
              await fresh();
              throw new Error("看板已更新，已重新加载，请继续操作。");
            }
            throw new Error(result.error.message);
          }
          if (result.data.boardVersion !== next.boardVersion) {
            await fresh();
            throw new Error("看板已更新，已重新加载。");
          }
          const page = result.data.columns.find((c) => c.status === column.status);
          if (!page) throw new Error("看板响应缺少目标列。");
          next = {
            ...next,
            columns: next.columns.map((c) =>
              c.status === column.status ? { ...page, items: [...c.items, ...page.items] } : c,
            ),
          };
          commit(next, source);
          cursor = page.nextCursor;
          if (!all) break;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败，请重试。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const move: MoveTask = async (task, status, beforeTaskId, options) => {
    if (lock.current || refreshing || !writable) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const source = state.source;
    const old = board;
    const placed = placeTask(board, task, status, beforeTaskId);
    // 拖拽落位由 dnd-kit 负责动画；从状态菜单移动时，卡片经视图过渡滑到目标列。
    if (options?.animate) startTransition(() => commit(placed, source));
    else commit(placed, source);
    let rollback = true;
    try {
      const result = await api.post(`/tasks/${task.id}/move`, MoveResultSchema, {
        expectedVersion: task.version,
        expectedBoardVersion: board.boardVersion,
        toStatus: status,
        beforeTaskId,
      });
      if (!result.ok) {
        commit(old, source);
        rollback = false;
        if (result.status === 401) {
          goToLogin();
          return;
        }
        if (result.status === 409) await fresh();
        throw new Error(result.error.message);
      }
      rollback = false;
      // 响应里就是这张卡片的最新状态和新的看板版本：直接落到本地，不再整板重读。
      // 之后的后台刷新只负责让服务端组件（和路由缓存）跟上。
      commit((current) => settleTask(current, result.data.task, result.data.boardVersion), source);
      setLanded(task.id);
      refresh();
    } catch (e) {
      if (rollback) commit(old, source);
      setError(e instanceof Error ? e.message : "移动失败，已恢复原顺序，请重试。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  // 卡片做了 memo，需要一个引用不变的移动回调；它总是调用最新的 move。
  // 用布局副作用更新：带视图过渡的提交要等动画结束才执行 useEffect，其间回调会停在上一次
  // 渲染的闭包上（旧的看板和版本号）。
  const latestMove = useRef(move);
  useLayoutEffect(() => {
    latestMove.current = move;
  });
  const stableMove = useCallback<MoveTask>((...args) => latestMove.current(...args), []);
  useEffect(() => {
    if (landed === null) return;
    const timer = setTimeout(() => setLanded(null), 900);
    return () => clearTimeout(timer);
  }, [landed]);

  function dragEnd(event: DragEndEvent) {
    if (!canDrag || !event.over || event.active.id === event.over.id) return;
    const task = board.columns.flatMap((c) => c.items).find((t) => t.id === event.active.id);
    if (!task) return;
    const column = board.columns.find(
      (c) => c.status === event.over?.id || c.items.some((t) => t.id === event.over?.id),
    );
    if (!column) return;
    const overIndex = column.items.findIndex((t) => t.id === event.over?.id);
    const fromIndex = column.items.findIndex((t) => t.id === task.id);
    const before =
      overIndex < 0
        ? null
        : task.status === column.status && fromIndex < overIndex
          ? (column.items[overIndex + 1]?.id ?? null)
          : (column.items[overIndex]?.id ?? null);
    void move(task, column.status, before);
  }
  const taskById = (id: string | number | undefined) =>
    board.columns.flatMap((c) => c.items).find((t) => t.id === id);
  const columnOf = (id: string | number | undefined) =>
    board.columns.find((c) => c.status === id || c.items.some((t) => t.id === id));
  function dragStart(event: DragStartEvent) {
    setDragging(taskById(event.active.id) ?? null);
  }
  function dragOver(event: DragOverEvent) {
    setDropTarget(event.over ? { id: String(event.over.id), status: columnOf(event.over.id)?.status ?? null } : null);
  }
  function dragFinish() {
    setDragging(null);
    setDropTarget(null);
  }
  const announcements: Announcements = {
    onDragStart: ({ active }) => `已拿起 ${taskById(active.id)?.identifier ?? "任务"}。`,
    onDragOver: ({ active, over }) =>
      over ? `${taskById(active.id)?.identifier ?? "任务"} 移到${STATUS_LABEL[columnOf(over.id)?.status ?? "TODO"]}列。` : undefined,
    onDragEnd: ({ active, over }) =>
      over ? `${taskById(active.id)?.identifier ?? "任务"} 已放入${STATUS_LABEL[columnOf(over.id)?.status ?? "TODO"]}列。` : "已取消移动。",
    onDragCancel: () => "已取消移动。",
  };

  return (
    <div
      className={cn("outline-none", dragging !== null && "select-none")}
      data-project-content
      tabIndex={-1}
      data-task-saving={busy || undefined}
      // 新建对话框打开或正在拖拽时，后台刷新先等一等。
      data-task-editing={creating !== null || dragging !== null || undefined}
    >
      <TaskFilters
        members={members}
        board
        action={
          writable ? (
            <Button onClick={() => setCreating("TODO")} aria-keyshortcuts="N" title="新建任务（N）" className="max-sm:h-11 max-sm:w-11 max-sm:px-0">
              <Plus className="h-4 w-4 max-sm:h-5 max-sm:w-5" aria-hidden="true" />
              <span className="max-sm:sr-only">新建任务</span>
            </Button>
          ) : null
        }
      />
      {writable && (
        <TaskCreateDialog
          open={creating !== null}
          onOpenChange={(open) => setCreating(open ? "TODO" : null)}
          projectId={project.id}
          defaultStatus={creating ?? "TODO"}
          onCreated={() => {
            // 新卡片由刷新后的服务端快照带来，到达时长出来。
            setCreating(null);
            refresh();
          }}
          onUnauthorized={goToLogin}
        />
      )}
      {error ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <InlineError className="min-w-0 flex-1">{error}</InlineError>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setError(null);
              void fresh().catch(() => setError("重新加载失败，请重试。"));
            }}
          >
            重新加载看板
          </Button>
        </div>
      ) : null}
      {writable && (filtered || !complete) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 px-1 text-caption text-foreground-muted">
          <p>{filtered ? "筛选视图下可通过任务状态菜单移动。" : "加载全部后可排序；也可以使用任务状态菜单。"}</p>
          {!filtered && !complete && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void load(undefined, true)}>
              {busy ? "加载中…" : "加载全部后排序"}
            </Button>
          )}
        </div>
      )}
      {/* 手机一次看一列：状态 tab 与列面板通过 id 关联，方向键循环 */}
      <Segments
        role="tablist"
        aria-label="看板状态"
        activeKey={selectedStatus}
        className="mb-3 flex rounded-full bg-surface-sunken p-1 md:hidden"
      >
        {board.columns.map((column) => {
          const active = column.status === selectedStatus;
          return (
            <button
              key={column.status}
              type="button"
              role="tab"
              id={`${tabPrefix}-${column.status}-tab`}
              aria-controls={`${tabPrefix}-${column.status}-panel`}
              data-active={active || undefined}
              tabIndex={active ? 0 : -1}
              onKeyDown={(event) => {
                const index = board.columns.findIndex((item) => item.status === column.status);
                const count = board.columns.length;
                const target = event.key === "ArrowRight" ? (index + 1) % count
                  : event.key === "ArrowLeft" ? (index + count - 1) % count
                  : event.key === "Home" ? 0 : event.key === "End" ? count - 1 : null;
                if (target === null) return;
                event.preventDefault();
                setMobileStatus(board.columns[target]!.status);
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus();
              }}
              aria-selected={active}
              onClick={() => setMobileStatus(column.status)}
              className={cn(
                "min-h-10 flex-1 rounded-full px-3 text-label font-medium outline-none transition-colors duration-200",
                active ? "text-foreground" : "text-foreground-secondary",
              )}
            >
              {STATUS_LABEL[column.status]}
              <AnimatedNumber value={column.total} className="ml-1.5 tabular-nums text-foreground-muted" />
            </button>
          );
        })}
      </Segments>
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCorners}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: "按空格键拿起任务，方向键移动，再按空格键放下，Escape 取消。" },
        }}
        onDragStart={dragStart}
        onDragOver={dragOver}
        onDragEnd={(event) => {
          dragFinish();
          dragEnd(event);
        }}
        onDragCancel={dragFinish}
      >
        <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-3 xl:gap-4">
          {board.columns.map((column) => (
            <Column
              key={column.status}
              column={column}
              canDrag={canDrag}
              writable={writable}
              busy={busy}
              today={today}
              animated={cardCount <= ANIMATED_CARD_LIMIT}
              landed={landed}
              onMove={stableMove}
              onLoad={() => void load(column.status)}
              onAdd={() => setCreating(column.status)}
              mobileVisible={column.status === selectedStatus}
              isMobile={isMobile}
              tabPrefix={tabPrefix}
              isTarget={dragging !== null && dropTarget?.status === column.status}
              insertBefore={dragging !== null && dragging.status !== column.status ? dropTarget?.id : undefined}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={dropAnimation}>
          {dragging ? (
            <div data-lens="" className="glass animate-lift cursor-grabbing rounded-tile p-3 shadow-[var(--glass-rim),var(--shadow-drag)]">
              <TaskCardFace
                task={dragging}
                today={today}
                status={<StatusGlyph status={dragging.status} className="mt-px" />}
                title={<p className="line-clamp-2 text-label font-medium">{dragging.title}</p>}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({
  column,
  canDrag,
  writable,
  busy,
  today,
  animated,
  landed,
  onMove,
  onLoad,
  onAdd,
  mobileVisible,
  isMobile,
  tabPrefix,
  isTarget,
  insertBefore,
}: {
  column: BoardColumnDTO;
  canDrag: boolean;
  writable: boolean;
  busy: boolean;
  today: string;
  /** 卡片是否参与视图过渡（数量很大时关闭）。 */
  animated: boolean;
  landed: string | null;
  onMove: MoveTask;
  onLoad: () => void;
  onAdd: () => void;
  /** 手机 tab 下只有选中的列可见，桌面三列不受影响。 */
  mobileVisible: boolean;
  isMobile: boolean;
  tabPrefix: string;
  isTarget: boolean;
  /** 跨列拖拽时落点的 id：某张卡片（插在它前面）或本列（放到列尾）。 */
  insertBefore?: string;
}) {
  const { setNodeRef } = useDroppable({ id: column.status, disabled: !canDrag });
  const label = STATUS_LABEL[column.status];
  const path = usePathname();
  const search = useSearchParams();
  const panel = useTaskPanel();
  // 顺序没变时保持同一个数组：dnd-kit 的排序上下文不重算，卡片也就不重新渲染。
  const order = column.items.map((t) => t.id).join(",");
  const ids = useMemo(() => (order ? order.split(",") : []), [order]);
  // 详情地址在当前筛选上加 task 参数；它不随「当前打开的是哪一条」变化。
  const filters = new URLSearchParams(search.toString());
  filters.delete("task");
  const hrefBase = `${path}?${filters.size ? `${filters}&` : ""}task=`;
  const card = (task: TaskSummaryDTO) => (
    <Card
      task={task}
      href={hrefBase + task.id}
      canDrag={canDrag}
      writable={writable}
      busy={busy}
      today={today}
      landed={landed === task.id}
      // 详情面板打开期间，对应的卡片保持可辨识；点击后立刻生效，不等地址更新。
      open={panel ? panel.activeId === task.id : search.get("task") === task.id}
      onOpen={panel?.open}
      onMove={onMove}
      showInsertLine={insertBefore === task.id}
    />
  );
  return (
    <section
      ref={setNodeRef}
      id={`${tabPrefix}-${column.status}-panel`}
      role={isMobile ? "tabpanel" : undefined}
      aria-labelledby={isMobile ? `${tabPrefix}-${column.status}-tab` : undefined}
      aria-label={isMobile ? undefined : label + "列"}
      tabIndex={isMobile ? 0 : undefined}
      className={cn(
        "min-h-40 rounded-card bg-surface-tray p-1.5 outline-none shadow-[inset_0_0_0_0.5px_var(--color-line)]",
        "transition-[background-color,box-shadow] duration-300 ease-out",
        isTarget && "bg-brand-soft shadow-[inset_0_0_0_1.5px_var(--color-brand)]",
        mobileVisible ? "" : "hidden md:block",
      )}
    >
      <div className="flex items-center gap-1 pb-1.5 pl-2.5 pr-1 pt-1 max-md:contents">
        <h2 className="flex min-w-0 flex-1 items-center gap-2 text-label font-semibold max-md:sr-only">
          <StatusGlyph status={column.status} className="h-4 w-4" />
          {label}
          <AnimatedNumber value={column.total} className="font-medium tabular-nums text-foreground-muted" />
        </h2>
        {writable ? (
          <IconButton label={`添加到${label}`} size="sm" className="max-md:hidden" onClick={onAdd}>
            <Plus className="h-4 w-4" />
          </IconButton>
        ) : (
          <span aria-hidden="true" className="h-8 max-md:hidden" />
        )}
      </div>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="space-y-1.5">
          {column.items.map((task) =>
            animated ? (
              // 具名：任务换列时从旧位置滑到新位置，而不是一边消失一边出现。
              <ItemTransition key={task.id} name={`task-${task.id}`} move>
                {card(task)}
              </ItemTransition>
            ) : (
              <Fragment key={task.id}>{card(task)}</Fragment>
            ),
          )}
        </div>
      </SortableContext>
      {column.items.length === 0 && (
        <p className="py-10 text-center text-caption text-foreground-muted">暂无任务</p>
      )}
      {/* 跨列拖到列尾：在最后一张卡片下面画落点。 */}
      {insertBefore === column.status && column.items.length > 0 ? (
        <span aria-hidden="true" className="mx-2 mt-1.5 block h-0.5 rounded-full bg-brand" />
      ) : null}
      {column.nextCursor && (
        <Button className="mt-1.5 w-full" size="sm" variant="ghost" disabled={busy} onClick={onLoad}>
          加载更多（{label}）
        </Button>
      )}
    </section>
  );
}

type CardProps = {
  task: TaskSummaryDTO;
  /** 打开这条任务详情的地址。 */
  href: string;
  canDrag: boolean;
  writable: boolean;
  busy: boolean;
  today: string;
  /** 刚刚落到这里：闪一下。 */
  landed: boolean;
  /** 详情面板正显示这条任务。 */
  open: boolean;
  /** 经面板宿主乐观打开详情；没有宿主时卡片标题就是普通链接。 */
  onOpen?: (task: TaskSummaryDTO, href: string, event?: MouseEvent) => void;
  onMove: MoveTask;
  showInsertLine: boolean;
};

function sameCard(a: CardProps, b: CardProps): boolean {
  return (
    sameTaskSummary(a.task, b.task) &&
    a.href === b.href &&
    a.canDrag === b.canDrag &&
    a.writable === b.writable &&
    a.busy === b.busy &&
    a.today === b.today &&
    a.landed === b.landed &&
    a.open === b.open &&
    a.onOpen === b.onOpen &&
    a.onMove === b.onMove &&
    a.showInsertLine === b.showInsertLine
  );
}

/**
 * 任务卡。做了 memo：后台刷新带来内容相同的新对象时不重新渲染，
 * 所以只有真正变化的卡片参与视图过渡。回调由调用方保持引用稳定。
 */
const Card = memo(function Card({
  task,
  href,
  canDrag,
  writable,
  busy,
  today,
  landed,
  open,
  onOpen,
  onMove,
  showInsertLine,
}: CardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, disabled: !canDrag });
  return (
    <article
      ref={setNodeRef}
      data-task-card={task.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // 鼠标可以按住卡片任意位置拖动；触屏只从手柄开始，避免和滚动冲突。
      onPointerDown={(event) => {
        if (event.pointerType !== "mouse" || (event.target as Element).closest("select, button")) return;
        listeners?.onPointerDown?.(event);
      }}
      // 点卡片的空白处也打开详情；链接、状态菜单和手柄各做各的事。拖拽结束时的那次点击已被 dnd-kit 拦掉。
      onClick={(event) => {
        if (!onOpen || event.defaultPrevented || (event.target as Element).closest("a, select, button")) return;
        onOpen(task, href);
      }}
      className={cn(
        "surface-card group relative rounded-tile p-3",
        !isDragging && "lift",
        isDragging && "opacity-35",
        onOpen && "cursor-pointer",
        landed && "animate-landed",
        open && "shadow-[inset_0_0_0_1.5px_var(--color-brand),var(--shadow-card)]",
      )}
    >
      {showInsertLine ? (
        <span aria-hidden="true" className="absolute inset-x-2 -top-1 h-0.5 rounded-full bg-brand" />
      ) : null}
      <TaskCardFace
        task={task}
        today={today}
        status={
          /* 状态图形本身就是移动菜单：系统原生下拉，读屏和键盘都能用 */
          <span className="relative -m-1.5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-sunken has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-ring [@media(pointer:coarse)]:-m-3 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
            <StatusGlyph status={task.status} animate={landed} />
            <select
              aria-label={`移动 ${task.identifier}`}
              title={STATUS_LABEL[task.status]}
              className="absolute inset-0 cursor-pointer appearance-none opacity-0 disabled:cursor-default"
              value={task.status}
              disabled={!writable || busy}
              onChange={(e) => void onMove(task, e.target.value as TaskStatus, null, { animate: true })}
            >
              {TASK_STATUS.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          </span>
        }
        title={
          <Link
            data-task-link={task.id}
            href={href}
            scroll={false}
            title={task.title}
            draggable={false}
            onClick={(event) => onOpen?.(task, href, event)}
            className="line-clamp-2 block rounded-[6px] text-label font-medium text-foreground [overflow-wrap:anywhere] hover:text-brand-ink"
          >
            {task.title}
          </Link>
        }
        corner={
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            disabled={!canDrag}
            aria-label={`排序 ${task.identifier}`}
            className="-mr-1 -mt-0.5 shrink-0 cursor-grab touch-none rounded-[8px] p-0.5 text-foreground-muted opacity-0 outline-none transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100 disabled:!opacity-0 [@media(hover:none)]:opacity-100"
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        }
      />
    </article>
  );
}, sameCard);
