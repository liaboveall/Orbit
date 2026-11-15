"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, TaskSchema, createApiClient, type DeletedTaskDTO } from "@/contracts";
import { useToast } from "@/components/ui/toast";

const api = createApiClient();

/**
 * 删除任务后的提示，带一个短暂的「撤销」（docs/02 §5：删除任务进入回收站，提供短暂撤销入口）。
 *
 * 撤销就是恢复：用删除响应里的 version 调 restore。幂等键在提示创建时生成一次，
 * 连点或重试不会恢复两次。点击操作后提示会自行关闭，所以网络失败时新的提示带「重试」
 * （同一个幂等键）；服务端明确拒绝时说明原因，任务仍在回收站里，可以去那里恢复。
 */
export function useUndoDelete(): (deleted: DeletedTaskDTO, identifier: string) => void {
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();

  return useCallback(
    (deleted, identifier) => {
      const idempotencyKey = crypto.randomUUID();
      let inFlight = false;
      async function restore(): Promise<void> {
        if (inFlight) return;
        inFlight = true;
        try {
          const result = await api.post(
            `/tasks/${deleted.id}/restore`,
            TaskSchema,
            { expectedVersion: deleted.version },
            { idempotencyKey },
          );
          if (result.ok) {
            toast({ title: "已恢复任务", description: identifier, variant: "success" });
            startTransition(() => router.refresh());
            return;
          }
          toast({
            title: "撤销失败",
            description: `${result.error.message} 可以在项目回收站中恢复。`,
            variant: "danger",
          });
        } catch (error) {
          toast({
            title: "撤销失败",
            description: error instanceof ApiClientError ? "无法连接服务器，任务仍在回收站中。" : "请稍后在项目回收站中恢复。",
            variant: "danger",
            action: { label: "重试", altText: "在项目回收站中恢复这条任务", onSelect: () => void restore() },
          });
        } finally {
          inFlight = false;
        }
      }
      toast({
        title: "任务已移入回收站",
        description: identifier,
        variant: "success",
        action: { label: "撤销", altText: "在项目回收站中恢复这条任务", onSelect: () => void restore() },
      });
    },
    [router, toast],
  );
}
