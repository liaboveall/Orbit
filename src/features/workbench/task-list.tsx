"use client";
import Link from "next/link";
import {
  type MyTasksQueryDTO,
  type TaskSummaryDTO,
} from "@/contracts";
import { Button } from "@/components/ui";
import { useAutoRefresh } from "@/features/tasks/real/use-auto-refresh";
import { usePagedTasks } from "@/features/tasks/use-paged-tasks";

/**
 * 工作台「我的任务」列表（M5 / ORB-019）。
 *
 * N02 修复：`rounded-panel` 改为已定义的 `rounded-card`（卡片语义圆角）。
 *
 * B9 修复（工作台部分）：空态按当前分类与筛选区分——「已完成」分类为空 ≠ 全部任务
 * 完成 ≠ 筛选无结果，各给准确文案；仅筛选为空时绝不声称「没有任务可做」。
 * 列表只掌握当前分类语义与是否有筛选参数，不做未授权的全局统计推断。
 */
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
  const activeBucket = query.bucket ?? "all_open";
  const hasFilters = Boolean(query.q || query.projectId || query.priority);

  return (
    <section
      aria-label="我的任务"
      className="rounded-card border border-line bg-surface p-4"
    >
      {tasks.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-foreground-muted">
            {activeBucket === "done"
              ? "还没有已完成的任务。"
              : hasFilters
                ? "没有符合当前筛选的任务。"
                : activeBucket === "all_open"
                  ? "没有进行中的任务。可以在项目中将任务分配给自己。"
                  : "该分类下暂无任务。"}
          </p>
          {hasFilters ? (
            <Link
              href="/app/today"
              className="mt-3 inline-flex h-9 items-center rounded-control border border-line bg-surface px-4 text-label font-medium outline-none transition-colors hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-brand"
            >
              清除筛选
            </Link>
          ) : (
            <p className="mt-3 text-caption text-foreground-muted">
              打开一个项目，把任务分配给自己后，这里会集中展示。
            </p>
          )}
        </div>
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
