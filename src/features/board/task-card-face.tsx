import type { ReactNode } from "react";
import type { TaskSummaryDTO } from "@/contracts";
import { Avatar } from "@/components/ui/avatar";
import { DueBadge, PriorityBadge } from "@/features/tasks/priority-badge";
import { getDueMeta } from "@/features/tasks/task-meta";
import { TaskResourceCounts } from "./task-resource-counts";

/**
 * 任务卡的内容排版，真实看板、拖拽浮层和公开演示共用。
 * 状态控件与标题由调用方传入，因为三处的交互不同。
 */
export function TaskCardFace({
  task,
  today,
  status,
  title,
  corner,
}: {
  task: TaskSummaryDTO;
  today: string;
  status: ReactNode;
  title: ReactNode;
  /** 右上角的操作，例如拖拽手柄或更多菜单。 */
  corner?: ReactNode;
}) {
  const due = getDueMeta(task.dueDate, today, task.status);
  return (
    <div className="flex items-start gap-2.5">
      {status}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">{title}</div>
          {corner}
        </div>
        <div className="flex items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-foreground-muted">
            <span className="tabular-nums">{task.identifier}</span>
            {task.priority !== "NONE" ? <PriorityBadge priority={task.priority} /> : null}
            {due.tone !== "none" ? <DueBadge meta={due} /> : null}
            <TaskResourceCounts task={task} />
          </div>
          {task.assignee ? (
            <span title={task.assignee.name} className="inline-flex shrink-0">
              <Avatar name={task.assignee.name} size="sm" />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
