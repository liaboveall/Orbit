"use client";

import { Undo2 } from "lucide-react";
import { useState } from "react";
import {
  ApiClientError,
  TaskSchema,
  createApiClient,
  type TaskSummaryDTO,
} from "@/contracts";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/inline-error";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";
import { loginPathWithReturnTo } from "@/lib/return-to";

/**
 * 任务恢复按钮（M2 Phase 6，POST /api/v1/tasks/{id}/restore）。
 *
 * 契约要点：expectedVersion 走**请求体**（VersionInput，与 DELETE 的查询参数不同），
 * 携带 Idempotency-Key；仅 owner 或任务创建者可恢复（服务端权威判定 403）；
 * 归档项目 → 409 PROJECT_ARCHIVED；恢复超未删除配额 → 422 LIMIT_EXCEEDED。
 *
 * 成功 → toast + `router.refresh()`（行从回收站消失）；
 * 409 VERSION_CONFLICT → toast「任务已被其他人更新」+ refresh；
 * 其余业务错误用 InlineError 驻留（错误不能只靠 toast，docs/02 §7）。
 */

import { useTaskMutation } from "./use-task-mutation";

const api = createApiClient();

export type TaskRestoreButtonProps = {
  /** 至少需要 id / version / identifier（TaskSummaryDTO 子集）。 */
  task: Pick<TaskSummaryDTO, "id" | "version" | "identifier">;
  /**
   * 当前用户是否可恢复（项目 owner 或任务创建者，由页面从服务端数据算出）。
   * 仅为入口收敛（docs/02：无权限时给出明确说明而非隐藏后无提示），
   * 服务端仍权威判定 403。
   */
  canRestore: boolean;
  /**
   * 会话失效（401）时硬跳转登录页所携带的 returnTo（当前回收站路径）。
   * 传可序列化字符串而非回调函数：本组件由 Server Component（trash/page.tsx）直接渲染，
   * React 禁止跨 RSC 边界向 Client Component 传递函数 props，故跳转在客户端内部完成。
   */
  returnTo: string;
};

export function TaskRestoreButton({
  task,
  canRestore,
  returnTo,
}: TaskRestoreButtonProps) {
  const mutation = useTaskMutation();
  const { pending } = mutation;
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  // 一次逻辑恢复操作复用 key（网络异常时重试复用同一 key）；若服务端返回明确业务错误（如 409 版本刷新后），则轮换新 key。
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  async function handleRestore(): Promise<void> {
    if (pending) return;
    setError(null);
    try {
      const result = await api.post(
        `/tasks/${task.id}/restore`,
        TaskSchema,
        { expectedVersion: task.version },
        { idempotencyKey },
      );
      if (result.ok) {
        toast({
          title: "任务已恢复",
          description: `${result.data.identifier} 已回到任务列表`,
          variant: "success",
        });
        mutation.refresh();
        return;
      }
      setIdempotencyKey(crypto.randomUUID());
      if (result.status === 401) {
        // 会话失效：硬跳转登录页（服务端重估认证态），带 returnTo 回到本回收站。
        window.location.assign(loginPathWithReturnTo(returnTo));
        return;
      }
      if (result.status === 409 && result.error.code === "VERSION_CONFLICT") {
        toast({
          title: "任务已被其他人更新",
          description: "已刷新为最新数据，请确认后重试。",
          variant: "danger",
        });
        mutation.refresh();
        return;
      }
      // 403（非 owner/创建者）、409 归档、422 配额等：信封 message 驻留展示。
      setError(result.error.message);
    } catch (cause) {
      setError(
        cause instanceof ApiClientError
          ? "无法连接服务器，请检查网络后重试。"
          : "恢复失败，请稍后重试。",
      );
    }
  }

  return (
    <span className="flex min-w-0 flex-col items-end gap-1.5">
      {canRestore ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          aria-busy={pending || undefined}
          onClick={() => {
            mutation.run(handleRestore);
          }}
        >
          {pending ? <Spinner /> : <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />}
          {/* 可见文本含 identifier：可访问名称与可见标签一致（WCAG 2.5.3 label-in-name）。 */}
          <span>{pending ? `正在恢复 ${task.identifier}…` : `恢复 ${task.identifier}`}</span>
        </Button>
      ) : (
        <span className="text-caption text-foreground-muted">
          仅项目所有者或创建者可恢复
        </span>
      )}
      <InlineError>{error}</InlineError>
    </span>
  );
}
