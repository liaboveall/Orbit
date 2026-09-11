"use client";

import { Plus, Search, X } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect as _useEffect, useMemo, useRef, useState } from "react";
import type { ProjectDTO, TaskPriority, TaskStatus, TaskSummaryDTO } from "@/contracts";
import { cn } from "@/lib/cn";
import { PROJECT_COLOR_DOT } from "@/lib/project-color";
import {
  Button,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  SkeletonBlock,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useFocusReturn,
  useToast,
} from "@/components/ui";
import { AvatarStack } from "@/components/ui/avatar";
import { TaskCard } from "./task-card";
import {
  BOARD_ASSIGNEES,
  BOARD_MEMBERS,
  BOARD_TASKS,
} from "./fixtures";
import { findProjectById, BOARD_PROJECT, SAMPLE_TODAY } from "@/features/shell/fixtures";
import { NoAccess, SampleError } from "@/features/shell/state-views";
import type { SampleState } from "@/features/shell/sample-state";
import { PRIORITY_LABEL, STATUS_COLUMN_ORDER, STATUS_LABEL, isOverdue } from "@/features/tasks/task-meta";
import { findTaskDetailById } from "@/features/tasks/fixtures";
import { TaskDetail } from "@/features/tasks/task-detail";

/**
 * 看板视图（ORB-002）。
 *
 * docs/02 §5：项目页头（标记色 + 名称 + 成员头像 + 新建任务）、二级导航（看板/列表/活动/设置，
 * M0 仅实现看板）、筛选行、三列固定（列头显示匹配总数）。手机 <768 按状态 Tabs 一次显示一列，
 * 用卡片菜单改状态（无拖拽）。详情走 `?task=<id>` 侧面板（桌面右侧 / 手机全屏），关闭移除参数。
 * M0 不做真实拖拽排序（属 M3/ORB-011），保留列间视觉分隔。⚠️ 数据来自 fixture。
 */

type AssigneeFilter = "all" | "unassigned" | string; // string = userId
type PriorityFilter = "all" | TaskPriority;

export type BoardViewProps = {
  projectId: string;
  state: SampleState;
  openTaskId: string | null;
};

export function BoardView({ projectId, state, openTaskId }: BoardViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const boardRef = useRef<HTMLDivElement>(null);
  const { captureFocus, returnFocusRef, handleCloseAutoFocus } = useFocusReturn();

  // Get current user ID from localStorage or use default
  // Note: This is computed once per render and matches M1/M2 patterns
  const currentUserId = typeof window !== "undefined" 
    ? (localStorage.getItem("orbit_current_user_id") || "user-default")
    : "user-default";

  const project: ProjectDTO = findProjectById(projectId) ?? BOARD_PROJECT;

  const [q, setQ] = useState("");
  const [assignee, setAssignee] = useState<AssigneeFilter>("all");
  const [priority, setPriority] = useState<PriorityFilter>("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [mobileStatus, setMobileStatus] = useState<TaskStatus>("TODO");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return BOARD_TASKS.filter((t) => {
      if (needle && !`${t.title} ${t.identifier}`.toLowerCase().includes(needle))
        return false;
      if (assignee === "unassigned" && t.assignee !== null) return false;
      if (assignee !== "all" && assignee !== "unassigned" && t.assignee?.id !== assignee)
        return false;
      if (priority !== "all" && t.priority !== priority) return false;
      if (overdueOnly && !isOverdue(t.dueDate, SAMPLE_TODAY, t.status)) return false;
      return true;
    });
  }, [q, assignee, priority, overdueOnly]);

  const hasActiveFilter =
    q.trim() !== "" || assignee !== "all" || priority !== "all" || overdueOnly;

  function clearFilters() {
    setQ("");
    setAssignee("all");
    setPriority("all");
    setOverdueOnly(false);
  }

  function withParams(mutate: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : "",
    );
    mutate(params);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  const openTask = (id: string) => {
    captureFocus();
    withParams((p) => p.set("task", id));
  };
  const closeTask = () => withParams((p) => p.delete("task"));

  const sampleAction = () =>
    toast({
      title: "样例模式：未连接真实后端",
      description: "该操作在真实数据层接入后才会发起请求。",
    });

  const openTaskDetail = openTaskId ? findTaskDetailById(openTaskId) : undefined;

  const columns = STATUS_COLUMN_ORDER.map((status) => ({
    status,
    tasks: filtered.filter((t) => t.status === status),
  }));

  return (
    <div ref={boardRef} tabIndex={-1} className="flex h-full flex-col">
      {/* 项目页头 */}
      {state === "permission" ? (
        <NoAccess reason="forbidden" />
      ) : (
        <>
          <ProjectHeader project={project} onNewTask={sampleAction} state={state} />

          {/* 二级导航 Tabs */}
          <Tabs defaultValue="board" className="mt-4">
            <TabsList aria-label="项目视图">
              <TabsTrigger value="board">看板</TabsTrigger>
              <TabsTrigger value="list">列表</TabsTrigger>
              <TabsTrigger value="activity">活动</TabsTrigger>
              <TabsTrigger value="settings">设置</TabsTrigger>
            </TabsList>

            <TabsContent value="board">
              {/* 筛选行 */}
              <FilterRow
                q={q}
                setQ={setQ}
                assignee={assignee}
                setAssignee={setAssignee}
                priority={priority}
                setPriority={setPriority}
                overdueOnly={overdueOnly}
                setOverdueOnly={setOverdueOnly}
                hasActiveFilter={hasActiveFilter}
                onClear={clearFilters}
                disabled={state === "loading"}
              />

              {state === "error" ? (
                <SampleError className="mt-4" message="看板加载失败，请重试。" />
              ) : state === "loading" ? (
                <BoardSkeleton />
              ) : state === "empty" ? (
                <EmptyState
                  className="mt-4"
                  icon={<Plus className="h-6 w-6" />}
                  title="这个项目还没有任务"
                  description="创建第一条任务，把要做的事安排到看板上。"
                  action={<Button onClick={sampleAction}>新建任务</Button>}
                />
              ) : (
                <>
                  {/* 桌面/平板：三列固定 */}
                  <div className="mt-4 hidden gap-4 md:grid md:grid-cols-3">
                    {columns.map((col) => (
                      <BoardColumn
                        key={col.status}
                        status={col.status}
                        tasks={col.tasks}
                        openTaskId={openTaskId}
                        onOpen={openTask}
                        onChangeStatus={sampleAction}
                        hasActiveFilter={hasActiveFilter}
                        onClear={clearFilters}
                      />
                    ))}
                  </div>

                  {/* 手机：按状态 Tabs 一次一列 */}
                  <div className="mt-4 md:hidden">
                    <Tabs
                      value={mobileStatus}
                      onValueChange={(v) => setMobileStatus(v as TaskStatus)}
                    >
                      <TabsList aria-label="按状态查看">
                        {STATUS_COLUMN_ORDER.map((s) => (
                          <TabsTrigger key={s} value={s}>
                            {STATUS_LABEL[s]}{" "}
                            {filtered.filter((t) => t.status === s).length}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                      {STATUS_COLUMN_ORDER.map((s) => (
                        <TabsContent key={s} value={s}>
                          <ColumnBody
                            tasks={filtered.filter((t) => t.status === s)}
                            openTaskId={openTaskId}
                            onOpen={openTask}
                            onChangeStatus={sampleAction}
                            hasActiveFilter={hasActiveFilter}
                            onClear={clearFilters}
                          />
                        </TabsContent>
                      ))}
                    </Tabs>
                  </div>
                </>
              )}
            </TabsContent>

            {["list", "activity", "settings"].map((v) => (
              <TabsContent key={v} value={v}>
                <EmptyState
                  icon={<Search className="h-6 w-6" />}
                  title={`${labelOfTab(v)}（M0 未实现）`}
                  description="ORB-002 只实现看板 tab 的布局样例，其余视图属后续里程碑。"
                />
              </TabsContent>
            ))}
          </Tabs>
        </>
      )}

      {/* 任务详情侧面板：桌面右侧 600px，手机全屏；由 ?task= 驱动 */}
      {openTaskDetail ? (
          <TaskDetail
            key={openTaskDetail.id}
            task={openTaskDetail}
            variant="panel"
            projectId={projectId}
            currentUserId={currentUserId}
            onClose={closeTask}
            onCloseAutoFocus={(event) => {
              if (returnFocusRef.current?.isConnected && returnFocusRef.current.getClientRects().length > 0) {
                handleCloseAutoFocus(event);
              } else {
                // 直链没有触发卡片；跨断点后原卡片也可能已隐藏。
                event.preventDefault();
                returnFocusRef.current = null;
                boardRef.current?.focus();
              }
            }}
          />
      ) : null}
    </div>
  );
}

function labelOfTab(v: string): string {
  return v === "list" ? "列表" : v === "activity" ? "活动" : "设置";
}

/* ── 项目页头 ─────────────────────────────────────────────────────────── */

function ProjectHeader({
  project,
  onNewTask,
  state,
}: {
  project: ProjectDTO;
  onNewTask: () => void;
  state: SampleState;
}) {
  if (state === "loading") {
    return (
      <SkeletonBlock label="项目页头加载中" className="flex items-center gap-3">
        <Skeleton className="h-4 w-4 rounded-full" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="ml-auto h-10 w-28 rounded-control" />
      </SkeletonBlock>
    );
  }
  return (
    <header className="flex flex-wrap items-center gap-3">
      <span
        className={cn("h-3.5 w-3.5 shrink-0 rounded-full", PROJECT_COLOR_DOT[project.color])}
        aria-hidden="true"
      />
      {/* 页面主标题：项目名（长名截断 + title/tooltip，不推挤主操作） */}
      <h1
        className="min-w-0 max-w-[60vw] truncate text-page font-semibold tracking-tight text-foreground"
        title={project.name}
      >
        {project.name}
      </h1>
      <span className="rounded-control bg-surface-sunken px-2 py-0.5 font-mono text-caption text-foreground-secondary">
        {project.key}
      </span>
      <AvatarStack names={BOARD_MEMBERS.map((m) => m.name)} max={3} />
      <Button className="ml-auto shrink-0" onClick={onNewTask}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        新建任务
      </Button>
    </header>
  );
}

/* ── 筛选行 ───────────────────────────────────────────────────────────── */

function FilterRow(props: {
  q: string;
  setQ: (v: string) => void;
  assignee: AssigneeFilter;
  setAssignee: (v: AssigneeFilter) => void;
  priority: PriorityFilter;
  setPriority: (v: PriorityFilter) => void;
  overdueOnly: boolean;
  setOverdueOnly: (v: boolean) => void;
  hasActiveFilter: boolean;
  onClear: () => void;
  disabled: boolean;
}) {
  const {
    q, setQ, assignee, setAssignee, priority, setPriority,
    overdueOnly, setOverdueOnly, hasActiveFilter, onClear, disabled,
  } = props;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[180px] flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={q}
          disabled={disabled}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索任务标题或编号"
          aria-label="搜索任务"
          className="pl-9"
        />
      </div>

      <Select value={assignee} onValueChange={setAssignee} disabled={disabled}>
        <SelectTrigger aria-label="按负责人筛选" className="w-auto min-w-32">
          <SelectValue placeholder="负责人" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部负责人</SelectItem>
          <SelectItem value="unassigned">未分配</SelectItem>
          {BOARD_ASSIGNEES.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={priority} onValueChange={setPriority} disabled={disabled}>
        <SelectTrigger aria-label="按优先级筛选" className="w-auto min-w-28">
          <SelectValue placeholder="优先级" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部优先级</SelectItem>
          {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
            <SelectItem key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <button
        type="button"
        onClick={() => setOverdueOnly(!overdueOnly)}
        disabled={disabled}
        aria-pressed={overdueOnly}
        className={cn(
          "h-10 rounded-control border px-3 text-label font-medium outline-none transition-colors duration-150 ease-standard",
          overdueOnly
            ? "border-danger bg-danger-soft text-danger"
            : "border-line-strong bg-surface text-foreground-secondary hover:bg-surface-sunken",
        )}
      >
        仅逾期
      </button>

      {hasActiveFilter ? (
        <Button variant="ghost" onClick={onClear} disabled={disabled}>
          <X className="h-4 w-4" aria-hidden="true" />
          清除筛选
        </Button>
      ) : null}
    </div>
  );
}

/* ── 列 ───────────────────────────────────────────────────────────────── */

function BoardColumn({
  status,
  tasks,
  ...rest
}: {
  status: TaskStatus;
  tasks: TaskSummaryDTO[];
  openTaskId: string | null;
  onOpen: (id: string) => void;
  onChangeStatus: () => void;
  hasActiveFilter: boolean;
  onClear: () => void;
}) {
  return (
    <section
      aria-labelledby={`col-${status}`}
      className="flex max-h-[calc(100dvh-16rem)] flex-col rounded-card bg-surface-sunken p-2"
    >
      <h2
        id={`col-${status}`}
        className="mb-2 flex items-center gap-2 px-1 text-label font-semibold text-foreground"
      >
        {STATUS_LABEL[status]}
        <span className="rounded-full bg-surface px-2 py-0.5 text-caption font-normal text-foreground-secondary">
          {tasks.length}
        </span>
      </h2>
      <ColumnBody tasks={tasks} {...rest} />
    </section>
  );
}

function ColumnBody({
  tasks,
  openTaskId,
  onOpen,
  onChangeStatus,
  hasActiveFilter,
  onClear,
}: {
  tasks: TaskSummaryDTO[];
  openTaskId: string | null;
  onOpen: (id: string) => void;
  onChangeStatus: () => void;
  hasActiveFilter: boolean;
  onClear: () => void;
}) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line bg-surface/60 p-4 text-center">
        <p className="text-caption text-foreground-muted">
          {hasActiveFilter ? "没有匹配任务" : "此列暂无任务"}
        </p>
        {hasActiveFilter ? (
          <Button variant="ghost" size="sm" className="mt-2" onClick={onClear}>
            清除筛选
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-2 overflow-y-auto pr-1">
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          selected={task.id === openTaskId}
          onOpen={() => onOpen(task.id)}
          onChangeStatus={onChangeStatus}
        />
      ))}
    </div>
  );
}

/* ── 加载骨架 ─────────────────────────────────────────────────────────── */

function BoardSkeleton() {
  return (
    <SkeletonBlock label="看板加载中" className="mt-4 grid gap-4 md:grid-cols-3">
      {STATUS_COLUMN_ORDER.map((s) => (
        <div key={s} className="rounded-card bg-surface-sunken p-2">
          <Skeleton className="mb-2 h-5 w-24" />
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-card" />
            ))}
          </div>
        </div>
      ))}
    </SkeletonBlock>
  );
}
