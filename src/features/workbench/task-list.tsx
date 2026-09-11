"use client";
import Link from "next/link";
import {
  type TaskSummaryDTO,
  type MyTasksQueryDTO,
} from "@/contracts";
import { Button } from "@/components/ui";
import { useAutoRefresh } from "@/features/tasks/real/use-auto-refresh";
import { usePagedTasks } from "@/features/tasks/use-paged-tasks";
export function MyTasksList({
  initialTasks,
  nextCursor,
  query,
}: {
  initialTasks: TaskSummaryDTO[];
  nextCursor: string | null;
  query: MyTasksQueryDTO;
}) {
  useAutoRefresh();
  const { tasks, cursor, busy, error, more } = usePagedTasks("/my/tasks", "workbench", query, initialTasks, nextCursor);
  return (
    <section
      aria-label="我的任务"
      className="rounded-panel border border-line bg-surface p-4"
    >
      {tasks.length === 0 ? (
        <p className="py-10 text-center text-foreground-muted">
          没有符合条件的任务。可以在项目中将任务分配给自己。
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {tasks.map((t) => (
            <li key={t.id} className="py-3">
              <Link
                className="block rounded-control p-2 focus-visible:outline-2 focus-visible:outline-brand"
                href={"/app/projects/" + t.projectId + "/tasks/" + t.id}
              >
                <span className="text-caption text-foreground-muted">
                  {t.identifier} ·{" "}
                  {t.status === "DONE"
                    ? "已完成"
                    : t.status === "IN_PROGRESS"
                      ? "进行中"
                      : "待办"}
                </span>
                <p className="break-words font-medium [overflow-wrap:anywhere]">
                  {t.title}
                </p>
                <p className="text-caption text-foreground-muted">
                  {t.dueDate ?? "无截止日"} · 子任务 {t.subtaskCompleted}/
                  {t.subtaskTotal} · 评论 {t.commentCount} · 附件{" "}
                  {t.attachmentCount}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {cursor && (
        <Button variant="secondary" disabled={busy} onClick={() => void more()}>
          {busy ? "加载中…" : "加载更多"}
        </Button>
      )}
    </section>
  );
}
