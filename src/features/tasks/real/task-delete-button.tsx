"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import {
  ApiClientError,
  DeletedTaskSchema,
  createApiClient,
  type TaskSummaryDTO,
} from "@/contracts";
import { Button, IconButton } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/features/auth/auth-form";

/**
 * 任务删除按钮 + 确认 Dialog（M2 Phase 6，DELETE /api/v1/tasks/{id}）。
 *
 * 契约要点：DELETE 的 expectedVersion 走**查询参数**（api.delete 的 options.query
 * 支持），软删除进回收站（可在 trash 页恢复），仅 owner 或任务创建者可删
 * （渲染入口已由列表按角色收敛，服务端仍权威判定 403）。
 *
 * 409 VERSION_CONFLICT → toast「任务已被其他人更新」+ refresh；
 * 成功 → toast + refresh（行从未删除列表消失）；401 → 父组件硬跳转登录。
 * 确认 Dialog 由 Radix 管理焦点陷阱/Escape/焦点恢复（docs/02 §7：破坏性操作须确认）。
 */

import type { TaskMutation } from "./use-task-mutation";

const api = createApiClient();

export type TaskDeleteButtonProps = {
  /** 至少需要 id / version / identifier / title（TaskSummaryDTO 子集）。 */
  task: Pick<TaskSummaryDTO, "id" | "version" | "identifier" | "title">;
  /** 401（会话失效）→ 父组件负责硬跳转登录页。 */
  onUnauthorized: () => void;
  mutation: TaskMutation;
};

export function TaskDeleteButton({ task, onUnauthorized, mutation }: TaskDeleteButtonProps) {
  const { pending } = mutation;
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  async function handleDelete(): Promise<void> {
    if (pending) return;
    try {
      const result = await api.delete(`/tasks/${task.id}`, DeletedTaskSchema, {
        query: { expectedVersion: task.version },
      });
      if (result.ok) {
        setOpen(false);
        toast({
          title: "任务已移入回收站",
          description: `${task.identifier} · 可在项目回收站中恢复`,
          variant: "success",
        });
        mutation.refresh();
        return;
      }
      if (result.status === 401) {
        setOpen(false);
        onUnauthorized();
        return;
      }
      if (result.status === 409 && result.error.code === "VERSION_CONFLICT") {
        setOpen(false);
        toast({
          title: "任务已被其他人更新",
          description: "已刷新为最新数据，请确认后重试。",
          variant: "danger",
        });
        mutation.refresh();
        return;
      }
      // 其余业务错误（403/404/归档等）：信封 message 直接可读，Dialog 保持打开供重试。
      toast({ title: "删除失败", description: result.error.message, variant: "danger" });
    } catch (error) {
      toast({
        title: "删除失败",
        description:
          error instanceof ApiClientError
            ? "无法连接服务器，请检查网络后重试。"
            : "请稍后重试。",
        variant: "danger",
      });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 请求进行中不允许关闭确认框（避免结果未定就丢失上下文）。
        if (!pending) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <IconButton label={`删除任务 ${task.identifier}`} size="sm" variant="ghost" disabled={pending}>
          <Trash2 className="h-4 w-4 text-foreground-muted" />
        </IconButton>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>删除任务</DialogTitle>
          <DialogDescription>
            将 <span className="font-mono text-foreground">{task.identifier}</span>「
            {task.title}」移入回收站？可随时在项目回收站中恢复。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={pending}>
              取消
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="danger"
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={() => {
              mutation.run(handleDelete);
            }}
          >
            {pending ? <Spinner /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
            <span>{pending ? "正在删除…" : "移入回收站"}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
