"use client";
import { useEffect } from "react";
import { onWake } from "@/lib/wake";

/** 保险用的慢轮询：正常情况下由 revision 变化驱动，不靠它。 */
const SAFETY_INTERVAL_MS = 120_000;

/**
 * 子任务、评论、附件列表的重读时机，不替换正在编辑的行和本地草稿。
 *
 * `revision` 是父任务的 updatedAt：这些子资源的每次写入都会更新它，页面保鲜
 * （见 features/shell/live.tsx）带来新的任务数据时，它一变就重读。另外在挂载、
 * 窗口重新获得焦点和标签页重新可见时各读一次。
 */
export function useResourceRefresh(
  load: () => Promise<void>,
  revision?: string,
) {
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active && document.visibilityState === "visible") void load();
    };
    const initial = setTimeout(refresh, 0),
      timer = setInterval(refresh, SAFETY_INTERVAL_MS);
    const stopWake = onWake(refresh);
    return () => {
      active = false;
      clearTimeout(initial);
      clearInterval(timer);
      stopWake();
    };
  }, [load, revision]);
}
