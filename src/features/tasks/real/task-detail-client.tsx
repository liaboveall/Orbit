"use client";

import { useState } from "react";
import type { TaskDTO, MemberDTO } from "@/contracts";
import { TaskEditor } from "./task-editor";
import { useAutoRefresh } from "./use-auto-refresh";

/**
 * TaskDetailClient（ORB-010）：包装 Server Component 传入的任务详情数据。
 *
 * 设计模式：
 *  - Server Component 已验证项目归属与权限，Client Component 仅负责渲染；
 *  - **不**将函数作为 props 传给子组件（M2 Bug 规避）；
 *  - 任务在别处被删除后，刷新得到 null：保留最后一次内容与已打开编辑器的草稿，
 *    以只读「任务已删除」状态展示，供复制后离开；首次打开即不存在则显示说明。
 */

export type TaskDetailClientProps = {
  /** 任务详情；项目可访问但任务不存在或已删除时为 null。 */
  taskDetail: TaskDTO | null;
  projectId: string;
  /** Current user id for draft isolation and permission checks */
  currentUserId: string;
  today: string;
  readOnly: boolean;
  canDelete: boolean;
  isProjectOwner: boolean;
  members: MemberDTO[];
};

export function TaskDetailClient({
  taskDetail,
  currentUserId,
  today,
  readOnly,
  canDelete,
  isProjectOwner,
  members,
}: TaskDetailClientProps) {
  useAutoRefresh();
  const [lastTask, setLastTask] = useState(taskDetail);
  if (taskDetail !== null && taskDetail !== lastTask) setLastTask(taskDetail);
  const shown = taskDetail ?? lastTask;
  if (!shown) {
    return (
      <div role="status" className="space-y-2 p-6">
        <h1 className="text-section font-semibold">任务不存在或已被删除</h1>
        <p className="text-label text-foreground-secondary">
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
