"use client";
import { loginPathWithReturnTo } from "@/lib/return-to";
import { useState, useRef, useEffect, useId, useSyncExternalStore, type CSSProperties } from "react";
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
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
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
import { Button, InlineError, PageHeader, Segments } from "@/components/ui";
import { ProjectGlyph } from "@/features/projects/project-glyph";
import { TaskCreateDialog } from "@/features/tasks/real/task-create-form";
import { TaskFilters } from "@/features/tasks/real/task-filters";
import { STATUS_LABEL } from "@/features/tasks/task-meta";
import { StatusGlyph } from "@/features/tasks/status-glyph";
import { useAutoRefresh } from "@/features/tasks/real/use-auto-refresh";
import { cn } from "@/lib/cn";
import { TaskCardFace } from "./task-card-face";

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
  const [dragging, setDragging] = useState<TaskSummaryDTO | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; status: TaskStatus | null } | null>(null);
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
            if (result.status === 401) {
              window.location.assign(
                loginPathWithReturnTo(location.pathname + location.search),
              );
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
        if (result.status === 401) {
          window.location.assign(
            loginPathWithReturnTo(location.pathname + location.search),
          );
          return;
        }
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
      className="outline-none"
      data-project-content
      tabIndex={-1}
      data-task-saving={busy || undefined}
      data-task-editing={creating || undefined}
    >
      <PageHeader
        leading={<ProjectGlyph name={project.name} color={project.color} size="lg" />}
        eyebrow={`${project.key} · ${project.memberCount} 名成员${writable ? "" : " · 已归档，只读"}`}
        title={project.name}
        actions={
          writable ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              新建任务
            </Button>
          ) : null
        }
      />
      <TaskFilters members={members} board />
      {writable && (
        <TaskCreateDialog
          open={creating}
          onOpenChange={setCreating}
          projectId={project.id}
          onCreated={async () => {
            setCreating(false);
            await fresh();
            router.refresh();
          }}
          onUnauthorized={() =>
            window.location.assign(
              loginPathWithReturnTo(location.pathname + location.search),
            )
          }
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
        <div className="mb-4 flex flex-wrap items-center gap-2 text-caption text-foreground-muted">
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
      {/* 手机一次看一列：状态 tab 与列面板通过 id 关联，方向键循环 */}
      <Segments
        role="tablist"
        aria-label="看板状态"
        activeKey={selectedStatus}
        className="mb-4 flex rounded-full bg-surface-sunken p-1 md:hidden"
        style={{ "--segment-inset": "4px" } as CSSProperties}
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
              className={cn(
                "min-h-10 flex-1 rounded-full px-3 text-label font-medium outline-none transition-colors duration-200",
                active ? "text-foreground" : "text-foreground-secondary",
              )}
            >
              {STATUS_LABEL[column.status]}
              <span className="ml-1.5 tabular-nums text-foreground-muted">{column.total}</span>
            </button>
          );
        })}
      </Segments>
      <DndContext
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
              onMove={move}
              onLoad={() => void load(column.status)}
              mobileVisible={column.status === selectedStatus}
              isMobile={isMobile}
              tabPrefix={tabPrefix}
              isTarget={dragging !== null && dropTarget?.status === column.status}
              insertBefore={dragging !== null && dragging.status !== column.status ? dropTarget?.id : undefined}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 240, easing: "cubic-bezier(0.32, 0.72, 0, 1)" }}>
          {dragging ? (
            <div className="glass-thick cursor-grabbing rounded-[18px] p-3 shadow-drag">
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
  onMove,
  onLoad,
  mobileVisible = true,
  isMobile,
  tabPrefix,
  isTarget,
  insertBefore,
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
  /** 手机 tab 下仅选中列可见（md 以上三列不受影响）。 */
  mobileVisible?: boolean;
  isTarget: boolean;
  /** 跨列拖拽时显示插入线的任务 id。 */
  insertBefore?: string;
}) {
  const { setNodeRef } = useDroppable({
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
      className={cn(
        "min-h-40 rounded-card bg-surface-tray p-2 outline-none transition-[background-color,box-shadow] duration-200 ease-standard",
        isTarget && "bg-brand-soft shadow-[inset_0_0_0_1.5px_var(--color-brand)]",
        mobileVisible ? "" : "hidden md:block",
      )}
    >
      <h2 className="mb-1.5 flex items-center justify-between px-2 py-1 text-label font-semibold max-md:sr-only">
        <span className="flex items-center gap-2">
          <StatusGlyph status={column.status} className="h-4 w-4" />
          {STATUS_LABEL[column.status]}
        </span>
        <span className="tabular-nums font-medium text-foreground-muted">{column.total}</span>
      </h2>
      <SortableContext
        items={column.items.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-2">
          {column.items.map((task) => (
            <Card
              key={task.id}
              task={task}
              canDrag={canDrag}
              writable={writable}
              busy={busy}
              today={today}
              onMove={onMove}
              showInsertLine={insertBefore === task.id}
            />
          ))}
        </div>
      </SortableContext>
      {column.items.length === 0 && (
        <p className="py-10 text-center text-caption text-foreground-muted">
          暂无任务
        </p>
      )}
      {column.nextCursor && (
        <Button
          className="mt-2 w-full"
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
  showInsertLine,
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
  showInsertLine: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
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
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // 鼠标可以按住卡片任意位置拖动；触屏只从手柄开始，避免和滚动冲突。
      onPointerDown={(event) => {
        if (event.pointerType !== "mouse" || (event.target as Element).closest("select, button")) return;
        listeners?.onPointerDown?.(event);
      }}
      className={cn(
        "glass-card group relative rounded-[18px] p-3",
        !isDragging && "lift",
        isDragging && "opacity-35",
        canDrag && "cursor-grab",
      )}
    >
      {showInsertLine ? (
        <span aria-hidden="true" className="absolute inset-x-2 -top-[5px] h-0.5 rounded-full bg-brand" />
      ) : null}
      <TaskCardFace
        task={task}
        today={today}
        status={
          /* 状态图形本身就是移动菜单：系统原生下拉，读屏和键盘都能用 */
          <span className="relative -m-1.5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-sunken has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-ring [@media(pointer:coarse)]:-m-3 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
            <StatusGlyph status={task.status} />
            <select
              aria-label={`移动 ${task.identifier}`}
              title={STATUS_LABEL[task.status]}
              className="absolute inset-0 cursor-pointer appearance-none opacity-0 disabled:cursor-default"
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
          </span>
        }
        title={
          <Link
            data-task-link={task.id}
            href={path + "?" + target.toString()}
            scroll={false}
            title={task.title}
            draggable={false}
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
            className="-mr-1 -mt-0.5 shrink-0 touch-none cursor-grab rounded-[8px] p-0.5 text-foreground-muted opacity-0 outline-none transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100 disabled:!opacity-0 [@media(hover:none)]:opacity-100"
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        }
      />
    </article>
  );
}
