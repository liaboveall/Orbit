"use client";
import { loginPathWithReturnTo } from "@/lib/return-to";
import { useState, useRef, useEffect } from "react";
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

const api = createApiClient();
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
  useAutoRefresh();
  const [state, setState] = useState({ source: initial, board: initial });
  if (state.source !== initial) setState({ source: initial, board: initial });
  const board = state.source === initial ? state.board : initial;
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
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
  const canDrag = writable && !busy && !filtered && complete;
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
        prev.source === initial ? { source: initial, board: value } : prev,
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
    commit(result.data);
    return result.data;
  }
  async function load(status?: TaskStatus, all = false) {
    if (lock.current) return;
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
            if (result.error.code === "BOARD_CONFLICT") {
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
    if (lock.current || !writable) return;
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
          <Button onClick={() => setCreating(!creating)}>新建任务</Button>
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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={dragEnd}
      >
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
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
}: {
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
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.status,
    disabled: !canDrag,
  });
  return (
    <section
      ref={setNodeRef}
      aria-label={STATUS_LABEL[column.status] + "列"}
      className={`min-h-40 rounded-card border p-3 ${isOver ? "border-brand bg-brand-soft" : "border-line bg-surface-sunken"}`}
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
      className="space-y-3 rounded-card border border-line bg-surface p-3 shadow-popover"
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
        className="block text-label font-medium [overflow-wrap:anywhere] hover:text-brand"
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
      <select
        aria-label={`移动 ${task.identifier}`}
        className="w-full rounded-control border border-line bg-surface px-2 py-1.5 text-caption"
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
