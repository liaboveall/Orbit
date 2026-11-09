"use client";

import {
  ApiClientError,
  TASK_STATUS,
  TaskSchema,
  createApiClient,
  type TaskStatus,
  type TaskSummaryDTO,
} from "@/contracts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { STATUS_LABEL } from "@/features/tasks/task-meta";

/**
 * 行内任务状态切换（M2 Phase 6，PATCH /api/v1/tasks/{id}）。
 *
 * 乐观并发：请求体携带 expectedVersion（列表数据里的 version）；服务端行锁内比对，
 * 不符 → 409 VERSION_CONFLICT → toast「任务已被其他人更新」+ `router.refresh()`
 * 拉最新数据（含新 version），不做客户端合并。
 *
 * 受控 Select 的值始终来自服务端 props：切换失败（冲突/归档/网络）时不更新本地值，
 * refresh 后自动回滚显示，保证 UI 与数据库一致（单一数据真源在服务端）。
 */

import type { TaskMutation } from "./use-task-mutation";

const api = createApiClient();

/** 业务错误码 → 面向用户的驻留提示文案。 */
const ERROR_TEXT: Record<string, string> = {
  VERSION_CONFLICT: "任务已被其他人更新，已刷新为最新数据。",
  PROJECT_ARCHIVED: "项目已归档，处于只读状态。",
  NOT_FOUND: "任务不存在或已被删除，列表即将刷新。",
  FORBIDDEN: "你没有权限执行该操作。",
  RATE_LIMITED: "操作过于频繁，请稍后再试。",
};

export type TaskStatusSelectProps = {
  /** 至少需要 id / version / status（TaskSummaryDTO 的子集即可，方便复用）。 */
  task: Pick<TaskSummaryDTO, "id" | "version" | "status" | "identifier">;
  disabled?: boolean;
  /** 401（会话失效）→ 父组件负责硬跳转登录页。 */
  onUnauthorized: () => void;
  mutation: TaskMutation;
};

export function TaskStatusSelect({ task, disabled, onUnauthorized, mutation }: TaskStatusSelectProps) {
  const { pending } = mutation;
  const { toast } = useToast();

  async function handleChange(next: TaskStatus): Promise<void> {
    if (pending || next === task.status) return;
    try {
      const result = await api.patch(`/tasks/${task.id}`, TaskSchema, {
        expectedVersion: task.version,
        status: next,
      });
      if (result.ok) {
        // 成功不弹 toast（状态列即时可见变化）；刷新 Transition 同步新 version 与排序，
        // 且 pending 在刷新 Transition 完成后才解除，避免用旧 version 立即再次提交。
        mutation.refresh();
        return;
      }
      if (result.status === 401) {
        onUnauthorized();
        return;
      }
      toast({
        title: "状态更新失败",
        description: ERROR_TEXT[result.error.code] ?? result.error.message,
        variant: "danger",
      });
      // 冲突/已删除/归档都意味着本地数据过期：刷新 Transition 提交最新状态后再解除 pending。
      mutation.refresh();
    } catch (error) {
      toast({
        title: "状态更新失败",
        description:
          error instanceof ApiClientError
            ? "无法连接服务器，请检查网络后重试。"
            : "请稍后重试。",
        variant: "danger",
      });
    }
  }

  return (
    <Select
      value={task.status}
      onValueChange={(value) => {
        mutation.run(() => handleChange(value as TaskStatus));
      }}
      disabled={disabled || pending}
    >
      <SelectTrigger
        className="h-11 w-auto rounded-full bg-transparent! pl-3 pr-2.5 shadow-none! hover:bg-surface-sunken! md:h-8 md:text-label"
        aria-label={`任务 ${task.identifier} 的状态${pending ? "（更新中）" : ""}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TASK_STATUS.map((option) => (
          <SelectItem key={option} value={option}>
            {STATUS_LABEL[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
