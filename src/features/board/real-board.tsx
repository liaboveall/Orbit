"use client";
import { loginPathWithReturnTo } from "@/lib/return-to";
import { useState, useRef, useEffect, useId, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import {
  BoardSchema,
  MoveResultSchema,
  createApiClient,
  TASK_STATUS,
  type BoardDTO,
  type BoardColumnDTO,
  type BoardQueryDTO,
  type ProjectDTO,
  type TaskStatus,
  type TaskSummaryDTO,
} from "@/contracts";
import { Button, InlineError } from "@/components/ui";
import { TaskCreateForm } from "@/features/tasks/real/task-create-form";
import { STATUS_LABEL, getDueMeta } from "@/features/tasks/task-meta";
import { DueBadge, PriorityBadge } from "@/features/tasks/priority-badge";
import { useAutoRefresh } from "@/features/tasks/real/use-auto-refresh";
import { confirmLeave } from "@/features/tasks/unsaved-changes";
import { TaskResourceCounts } from "./task-resource-counts";

const api = createApiClient();
const mobileQuery = "(max-width: 767px)";
function subscribeMobile(callback: () => void) {
  const media = window.matchMedia(mobileQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const readMobile = () => window.matchMedia(mobileQuery).matches;
const serverMobile = () => false;
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
export function RealBoard({
  initial,
  project,
  query,
  today,
}: {
  initial: BoardDTO;
  project: ProjectDTO;
  query: BoardQueryDTO;
  today: string;
}) {
  const router = useRouter();
  const tabPrefix = useId();
  const isMobile = useSyncExternalStore(subscribeMobile, readMobile, serverMobile);
  useAutoRefresh();
  const context = JSON.stringify([project.id, today, query]);
  const [state, setState] = useState({ source: initial, board: initial, context, previous: initial, refreshing: false });
  if (state.source !== initial || state.context !== context) setState({ source: initial, board: state.context === context ? state.board : initial, context, previous: state.context === context ? state.board : initial, refreshing: state.context === context });
  const board = state.source === initial ? state.board : initial;
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    const controller = new AbortController();
    if (state.refreshing) {
      void refillBoard(`/projects/${project.id}/board`, JSON.parse(queryKey) as BoardQueryDTO, state.source, state.previous, controller.signal)
        .then((value) => { if (!controller.signal.aborted) setState((prev) => ({ ...prev, board: value, refreshing: false })); })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) {
            setState((prev) => ({ ...prev, refreshing: false }));
            setError(reason instanceof Error ? reason.message : "刷新失败，请重试。");
          }
        });
    }
    return () => controller.abort();
  }, [state.refreshing, state.source, state.previous, project.id, queryKey]);
  const [creating, setCreating] = useState(false);
  // B8 修复：手机（<md）用状态 tab 单列查看，避免三列纵向长页堆叠；桌面保持三列。
  const [mobileStatus, setMobileStatus] = useState<TaskStatus>(query.status ?? "TODO");
  const selectedStatus = board.columns.some(column => column.status === mobileStatus) ? mobileStatus : board.columns[0]?.status;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const filtered = Boolean(
    query.q ||
      query.status ||
      query.priority ||
      query.assigneeId ||
      query.unassigned ||
      query.overdue,
  );
  const complete =
    board.columns.length === 3 &&
    board.columns.every((c) => c.nextCursor === null);
  const writable = project.archivedAt === null;
  const canDrag = writable && !busy && !state.refreshing && !filtered && complete;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  function commit(value: BoardDTO) {
    if (alive.current)
      setState((prev) =>
        prev.source === initial ? { ...prev, board: value } : prev,
      );
  }
  async function fresh() {
    const result = await api.get(`/projects/${project.id}/board`, BoardSchema, {
      query,
    });
    if (!result.ok) {
      if (result.status === 401)
        window.location.assign(
          loginPathWithReturnTo(location.pathname + location.search),
        );
      if (result.status === 404) router.refresh();
      throw new Error(result.error.message);
    }
    const refreshed = await refillBoard(`/projects/${project.id}/board`, query, result.data, board);
    commit(refreshed);
    return refreshed;
  }
  async function load(status?: TaskStatus, all = false) {
    if (lock.current || state.refreshing) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    let next = board;
    try {
      for (const column of board.columns.filter(
        (c) => !status || c.status === status,
      )) {
        let cursor = column.nextCursor;
        while (cursor) {
          const result = await api.get(
            `/projects/${project.id}/board`,
            BoardSchema,
            { query: { ...query, status: column.status, cursor, limit: 100 } },
          );
          if (!result.ok) {
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
          const page = result.data.columns.find(
            (c) => c.status === column.status,
          );
          if (!page) throw new Error("看板响应缺少目标列。");
          next = {
            ...next,
            columns: next.columns.map((c) =>
              c.status === column.status
                ? { ...page, items: [...c.items, ...page.items] }
                : c,
            ),
          };
          commit(next);
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
  async function move(
    task: TaskSummaryDTO,
    status: TaskStatus,
    beforeTaskId: string | null,
  ) {
    if (lock.current || state.refreshing || !writable) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const old = board;
    let rollback = true;
    const columns = board.columns.map((c) => ({
      ...c,
      items: c.items.filter((t) => t.id !== task.id),
      total: c.total - (c.status === task.status ? 1 : 0),
    }));
    const target = columns.find((c) => c.status === status);
    if (target) {
      const index = beforeTaskId
        ? target.items.findIndex((t) => t.id === beforeTaskId)
        : -1;
      target.items.splice(index < 0 ? target.items.length : index, 0, {
        ...task,
        status,
      });
      target.total++;
    }
    commit({ ...board, columns });
    try {
      const result = await api.post(
        `/tasks/${task.id}/move`,
        MoveResultSchema,
        {
          expectedVersion: task.version,
          expectedBoardVersion: board.boardVersion,
          toStatus: status,
          beforeTaskId,
        },
      );
      if (!result.ok) {
        commit(old);
        rollback = false;
        if (result.status === 409) await fresh();
        throw new Error(result.error.message);
      }
      rollback = false;
      await fresh();
      router.refresh();
    } catch (e) {
      if (rollback) commit(old);
      setError(
        e instanceof Error ? e.message : "移动失败，已恢复原顺序，请重试。",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function dragEnd(event: DragEndEvent) {
    if (!canDrag || !event.over || event.active.id === event.over.id) return;
    const task = board.columns
      .flatMap((c) => c.items)
      .find((t) => t.id === event.active.id);
    if (!task) return;
    const column = board.columns.find(
      (c) =>
        c.status === event.over?.id ||
        c.items.some((t) => t.id === event.over?.id),
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
  return (
    <div
      className="space-y-5"
      data-project-content
      tabIndex={-1}
      data-task-saving={busy || undefined}
      data-task-editing={creating || undefined}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-page font-semibold">{project.name}</h1>
          <p className="text-caption text-foreground-muted">
            {project.key} · {project.memberCount} 名成员
            {!writable && " · 已归档，只读"}
          </p>
        </div>
        {writable && (
          <Button onClick={() => { if (!creating || confirmLeave()) setCreating(!creating); }}>新建任务</Button>
        )}
      </header>
      {creating && writable && (
        <TaskCreateForm
          projectId={project.id}
          onCreated={async () => {
            setCreating(false);
            await fresh();
            router.refresh();
          }}
          onCancelled={() => setCreating(false)}
          onUnauthorized={() =>
            window.location.assign(
              loginPathWithReturnTo(location.pathname + location.search),
            )
          }
        />
      )}
      <InlineError>{error}</InlineError>
      {error && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setError(null);
            void fresh().catch(() => setError("重新加载失败，请重试。"));
          }}
        >
          重新加载看板
        </Button>
      )}
      {!canDrag && writable && (
        <div className="flex flex-wrap items-center gap-2 text-caption text-foreground-secondary">
          <p>
            {filtered
              ? "筛选视图下可通过任务状态菜单移动。"
              : "加载全部后可排序；也可以使用任务状态菜单。"}
          </p>
          {!filtered && !complete && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void load(undefined, true)}
            >
              {busy ? "加载中…" : "加载全部后排序"}
            </Button>
          )}
        </div>
      )}
      {/* 手机状态 tab（B8）：带列计数，选中列单列显示；筛选/分页/冲突回滚逻辑不变 */}
      <div
        role="tablist"
        aria-label="看板状态"
        className="flex gap-2 md:hidden"
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
              tabIndex={active ? 0 : -1}
              onKeyDown={(event) => {
                const index = board.columns.findIndex(item => item.status === column.status);
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
              className={
                "min-h-11 flex-1 rounded-control border px-3 py-2 text-label font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand " +
                (active
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-line bg-surface text-foreground-secondary hover:bg-surface-sunken")
              }
            >
              {STATUS_LABEL[column.status]}
              <span className="ml-1 font-mono text-caption text-foreground-muted">
                {column.total}
              </span>
            </button>
          );
        })}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={dragEnd}
      >
        {/* F29：三列起点与任务列表/表格的 md(768) 切换点统一（原 lg）。 */}
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-3">
          {board.columns.map((column) => (
            <Column
              key={column.status}
              column={column}
              canDrag={canDrag}
              writable={writable}
              busy={busy}
              today={today}
              onMove={move}
              onLoad={() => void load(column.status)}
              mobileVisible={column.status === selectedStatus}
              isMobile={isMobile}
              tabPrefix={tabPrefix}
            />
          ))}
        </div>
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
  onMove,
  onLoad,
  mobileVisible = true,
  isMobile,
  tabPrefix,
}: {
  isMobile: boolean;
  tabPrefix: string;
  column: BoardColumnDTO;
  canDrag: boolean;
  writable: boolean;
  busy: boolean;
  today: string;
  onMove: (
    task: TaskSummaryDTO,
    status: TaskStatus,
    before: string | null,
  ) => Promise<void>;
  onLoad: () => void;
  /** B8：手机 tab 下仅选中列可见（md+ 三列不受影响）。 */
  mobileVisible?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.status,
    disabled: !canDrag,
  });
  return (
    <section
      ref={setNodeRef}
      id={`${tabPrefix}-${column.status}-panel`}
      role={isMobile ? "tabpanel" : undefined}
      aria-labelledby={isMobile ? `${tabPrefix}-${column.status}-tab` : undefined}
      aria-label={isMobile ? undefined : STATUS_LABEL[column.status] + "列"}
      tabIndex={isMobile ? 0 : undefined}
      className={`min-h-40 rounded-card border p-3 ${isOver ? "border-brand bg-brand-soft" : "border-line bg-surface-sunken"} ${mobileVisible ? "" : "hidden md:block"}`}
    >
      <h2 className="mb-3 flex justify-between text-label font-medium">
        <span>{STATUS_LABEL[column.status]}</span>
        <span className="font-mono text-foreground-muted">{column.total}</span>
      </h2>
      <SortableContext
        items={column.items.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-3">
          {column.items.map((task) => (
            <Card
              key={task.id}
              task={task}
              canDrag={canDrag}
              writable={writable}
              busy={busy}
              today={today}
              onMove={onMove}
            />
          ))}
        </div>
      </SortableContext>
      {column.items.length === 0 && (
        <p className="py-8 text-center text-caption text-foreground-muted">
          暂无任务
        </p>
      )}
      {column.nextCursor && (
        <Button
          className="mt-3 w-full"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onLoad}
        >
          加载更多（{STATUS_LABEL[column.status]}）
        </Button>
      )}
    </section>
  );
}
function Card({
  task,
  canDrag,
  writable,
  busy,
  today,
  onMove,
}: {
  task: TaskSummaryDTO;
  canDrag: boolean;
  writable: boolean;
  busy: boolean;
  today: string;
  onMove: (
    task: TaskSummaryDTO,
    status: TaskStatus,
    before: string | null,
  ) => Promise<void>;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: !canDrag });
  const path = usePathname();
  const search = useSearchParams();
  const target = new URLSearchParams(search.toString());
  target.set("task", task.id);
  return (
    <article
      ref={setNodeRef}
      data-task-card={task.id}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className={
        "space-y-3 rounded-card border border-line bg-surface p-3 " +
        // F28 修复：影子只用于悬浮层；拖拽浮层用 shadow-drag 与静态表面区分。
        (isDragging ? "shadow-drag" : "")
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-caption text-foreground-muted">
          {task.identifier}
        </span>
        <button
          {...attributes}
          {...listeners}
          disabled={!canDrag}
          aria-label={`排序 ${task.identifier}`}
          className="touch-none rounded-control p-1 disabled:opacity-30"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </div>
      <Link
        data-task-link={task.id}
        href={path + "?" + target.toString()}
        scroll={false}
        title={task.title}
        className="line-clamp-2 block text-label font-medium [overflow-wrap:anywhere] hover:text-brand"
      >
        {task.title}
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <PriorityBadge priority={task.priority} />
        <DueBadge meta={getDueMeta(task.dueDate, today, task.status)} />
        <span className="text-caption text-foreground-muted">
          {task.assignee?.name ?? "未分配"}
        </span>
      </div>
      <TaskResourceCounts task={task} />
      <select
        aria-label={`移动 ${task.identifier}`}
        className="w-full rounded-control border border-line bg-surface px-2 py-1.5 text-body md:text-caption"
        value={task.status}
        disabled={!writable || busy}
        onChange={(e) => void onMove(task, e.target.value as TaskStatus, null)}
      >
        {TASK_STATUS.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABEL[status]}
          </option>
        ))}
      </select>
    </article>
  );
}
