"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

/** 同一任务的写操作共用 pending，覆盖 API 请求和新 RSC 提交到界面的整个过程。 */
export function useTaskMutation() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  function run(action: () => Promise<void>) {
    if (pending || inFlight.current) return;
    inFlight.current = true;
    startTransition(async () => {
      try { await action(); }
      finally { inFlight.current = false; }
    });
  }
  function refresh() {
    // await 之后的路由更新需显式放进 Transition；refresh 本身返回 void。
    startTransition(() => router.refresh());
  }
  return { pending, run, refresh };
}

export type TaskMutation = ReturnType<typeof useTaskMutation>;
