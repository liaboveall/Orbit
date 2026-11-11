"use client";

import { useState } from "react";
import type { TaskDTO, MemberDTO } from "@/contracts";
import { TaskEditor } from "./task-editor";
import { useAutoRefresh } from "./use-auto-refresh";

/**
 * 独立任务详情页的编辑器外壳。
 *
 * 任务在别处被删除后，刷新得到 null：保留最后一次内容和已打开编辑器里的草稿，
 * 以只读的「任务已删除」状态显示，供复制后离开。首次打开就不存在则显示说明。
 */
export function TaskDetailClient({
  taskDetail,
  currentUserId,
  today,
  readOnly,
  canDelete,
  isProjectOwner,
  members,
}: {
  /** 任务详情；项目可访问但任务不存在或已删除时为 null。 */
  taskDetail: TaskDTO | null;
  currentUserId: string;
  today: string;
  readOnly: boolean;
  canDelete: boolean;
  isProjectOwner: boolean;
  members: MemberDTO[];
}) {
  useAutoRefresh();
  const [lastTask, setLastTask] = useState(taskDetail);
  if (taskDetail !== null && taskDetail !== lastTask) setLastTask(taskDetail);
  const shown = taskDetail ?? lastTask;
  if (!shown) {
    return (
      <div role="status" className="surface-card mx-4 space-y-2 rounded-card p-6 sm:mx-5">
        <h1 className="text-section font-semibold tracking-[-0.012em]">任务不存在或已被删除</h1>
        <p className="text-label leading-relaxed text-foreground-secondary">
          它可能已被移入回收站，或链接有误。可以返回看板查看其它任务。
        </p>
      </div>
    );
  }
  return (
    <TaskEditor
      members={members}
      task={shown}
      currentUserId={currentUserId}
      today={today}
      readOnly={readOnly}
      unavailable={taskDetail === null}
      titleLevel={1}
      canDelete={taskDetail !== null && canDelete}
      isProjectOwner={isProjectOwner}
    />
  );
}
