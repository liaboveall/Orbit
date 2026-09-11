"use client";

import type { TaskDTO, MemberDTO } from "@/contracts";
import { TaskEditor } from "./task-editor";
import { useAutoRefresh } from "./use-auto-refresh";

/**
 * TaskDetailClient（ORB-010）：包装 Server Component 传入的任务详情数据。
 *
 * 设计模式：
 *  - Server Component 已验证项目归属与权限，Client Component 仅负责渲染；
 *  - **不**将函数作为 props 传给子组件（M2 Bug 规避）。
 */

export type TaskDetailClientProps = {
  /** 任务详情（包含所有必需字段） */
  taskDetail: TaskDTO;
  projectId: string;
  /** Current user id for draft isolation and permission checks */
  currentUserId: string;
  today: string;
  readOnly: boolean;
  canDelete: boolean;
  members: MemberDTO[];
};

export function TaskDetailClient({
  taskDetail,
  currentUserId,
  today,
  readOnly,
  canDelete,
  members,
}: TaskDetailClientProps) {
  useAutoRefresh();
  return (
    <TaskEditor
      members={members}
      task={taskDetail}
      currentUserId={currentUserId}
      today={today}
      readOnly={readOnly}
      canDelete={canDelete}
    />
  );
}
