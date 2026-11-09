"use client";

import Link from "next/link";
import { type MyTasksQueryDTO, type TaskSummaryDTO } from "@/contracts";
import { Button, buttonVariants, EmptyState, InlineError } from "@/components/ui";
import { TaskResourceCounts } from "@/features/board/task-resource-counts";
import { DueBadge, PriorityBadge } from "@/features/tasks/priority-badge";
import { useAutoRefresh } from "@/features/tasks/real/use-auto-refresh";
import { StatusGlyph } from "@/features/tasks/status-glyph";
import { getDueMeta } from "@/features/tasks/task-meta";
import { usePagedTasks } from "@/features/tasks/use-paged-tasks";
import { CheckCheck, Inbox, SearchX } from "lucide-react";

/**
 * 工作台「我的任务」列表。
 * 空态按分类与筛选区分：筛选为空时不声称「没有任务可做」。
 */
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
        <ul className="glass-card divide-y divide-line overflow-hidden rounded-card">
          {tasks.map((t) => {
            const due = getDueMeta(t.dueDate, today, t.status);
            return (
              <li key={t.id}>
                <Link
                  className="flex items-center gap-3 px-4 py-3 outline-none transition-colors duration-150 ease-standard -outline-offset-2 hover:bg-surface-sunken"
                  href={"/app/projects/" + t.projectId + "/tasks/" + t.id}
                >
                  <StatusGlyph status={t.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-label font-medium text-foreground [overflow-wrap:anywhere]">
                      {t.title}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-foreground-muted">
                      <span className="tabular-nums">{t.identifier}</span>
                      <TaskResourceCounts task={t} />
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
                    {t.priority === "HIGH" ? <PriorityBadge priority={t.priority} /> : null}
                    <DueBadge meta={due} />
                  </span>
                </Link>
              </li>
            );
          })}
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
