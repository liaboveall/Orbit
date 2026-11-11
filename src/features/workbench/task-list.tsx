"use client";

import Link from "next/link";
import { CheckCheck, ChevronRight, Inbox, SearchX } from "lucide-react";
import { type MyTasksQueryDTO, type TaskSummaryDTO } from "@/contracts";
import { Button, buttonVariants, EmptyState, InlineError } from "@/components/ui";
import { TaskResourceCounts } from "@/features/board/task-resource-counts";
import { DueBadge, PriorityMark } from "@/features/tasks/priority-badge";
import { useAutoRefresh } from "@/features/tasks/real/use-auto-refresh";
import { StatusGlyph } from "@/features/tasks/status-glyph";
import { getDueMeta } from "@/features/tasks/task-meta";
import { usePagedTasks } from "@/features/tasks/use-paged-tasks";

/** 工作台的任务列表：跨项目分配给我的任务，每一行进入任务详情。 */
export function MyTasksList({
  initialTasks,
  nextCursor,
  query,
  today,
}: {
  initialTasks: TaskSummaryDTO[];
  nextCursor: string | null;
  query: MyTasksQueryDTO;
  today: string;
}) {
  useAutoRefresh();
  const { tasks, cursor, busy, error, more } = usePagedTasks("/my/tasks", "workbench", query, initialTasks, nextCursor);
  const activeBucket = query.bucket ?? "all_open";
  const hasFilters = Boolean(query.q || query.projectId || query.priority);

  return (
    <section aria-label="我的任务">
      {tasks.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<SearchX className="h-6 w-6" />}
            title="没有符合当前筛选的任务"
            action={
              <Link href="/app/today" className={buttonVariants({ variant: "secondary" })}>
                清除筛选
              </Link>
            }
          />
        ) : activeBucket === "all_open" ? (
          <EmptyState
            icon={<CheckCheck className="h-6 w-6" />}
            title="没有待处理的任务"
            description="打开一个项目，把任务分配给自己后，这里会集中展示。"
            action={
              <Link href="/app/projects" className={buttonVariants({ variant: "secondary" })}>
                查看全部项目
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<Inbox className="h-6 w-6" />}
            title={activeBucket === "done" ? "还没有已完成的任务" : "该分类下暂无任务"}
          />
        )
      ) : (
        <ul className="surface-card divide-y divide-line overflow-hidden rounded-card">
          {tasks.map((task) => (
            <li key={task.id}>
              <Link
                href={`/app/projects/${task.projectId}/tasks/${task.id}`}
                className="group flex items-center gap-3 py-3 pl-4 pr-3 outline-none transition-colors duration-150 ease-standard -outline-offset-2 hover:bg-surface-sunken"
              >
                <StatusGlyph status={task.status} />
                <span className="min-w-0 flex-1">
                  <span className="block text-label font-medium text-foreground [overflow-wrap:anywhere]">
                    {task.title}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-foreground-muted">
                    <span className="tabular-nums">{task.identifier}</span>
                    <TaskResourceCounts task={task} />
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3.5">
                  <PriorityMark priority={task.priority} />
                  <DueBadge meta={getDueMeta(task.dueDate, today, task.status)} />
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-foreground-muted opacity-50 transition-[opacity,transform] duration-200 group-hover:translate-x-0.5 group-hover:opacity-100 max-sm:hidden"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <InlineError className="mt-3">{error}</InlineError>
      {cursor && (
        <div className="mt-5 flex justify-center">
          <Button variant="secondary" disabled={busy} onClick={() => void more()}>
            {busy ? "加载中…" : "加载更多"}
          </Button>
        </div>
      )}
    </section>
  );
}
