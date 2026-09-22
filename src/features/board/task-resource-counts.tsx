import { ListTodo, MessageSquare, Paperclip } from "lucide-react";
import type { TaskSummaryDTO } from "@/contracts";

/** Shared by the live board and sample cards to keep collaboration details consistent. */
export function TaskResourceCounts({ task }: {
  task: Pick<TaskSummaryDTO, "subtaskTotal" | "subtaskCompleted" | "commentCount" | "attachmentCount">;
}) {
  if (!task.subtaskTotal && !task.commentCount && !task.attachmentCount) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-caption text-foreground-muted">
      {task.subtaskTotal > 0 && <span className="inline-flex items-center gap-1"><ListTodo aria-hidden="true" className="h-3.5 w-3.5" />子任务 {task.subtaskCompleted}/{task.subtaskTotal}</span>}
      {task.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />评论 {task.commentCount}</span>}
      {task.attachmentCount > 0 && <span className="inline-flex items-center gap-1"><Paperclip aria-hidden="true" className="h-3.5 w-3.5" />附件 {task.attachmentCount}</span>}
    </div>
  );
}
