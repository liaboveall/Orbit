import { ListTodo, MessageSquare, Paperclip } from "lucide-react";
import type { TaskSummaryDTO } from "@/contracts";

/** 子任务、评论、附件计数。看板、演示和工作台共用，图形加数字，名称留给读屏。 */
export function TaskResourceCounts({ task }: {
  task: Pick<TaskSummaryDTO, "subtaskTotal" | "subtaskCompleted" | "commentCount" | "attachmentCount">;
}) {
  if (!task.subtaskTotal && !task.commentCount && !task.attachmentCount) return null;
  const item = "inline-flex items-center gap-1 tabular-nums";
  return (
    <div className="flex flex-wrap items-center gap-3 text-caption text-foreground-muted">
      {task.subtaskTotal > 0 && (
        <span className={item}>
          <ListTodo aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="sr-only">子任务 </span>
          {task.subtaskCompleted}/{task.subtaskTotal}
        </span>
      )}
      {task.commentCount > 0 && (
        <span className={item}>
          <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="sr-only">评论 </span>
          {task.commentCount}
        </span>
      )}
      {task.attachmentCount > 0 && (
        <span className={item}>
          <Paperclip aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="sr-only">附件 </span>
          {task.attachmentCount}
        </span>
      )}
    </div>
  );
}
