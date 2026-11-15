"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * 当前是否有对话框或抽屉在屏幕上（含它们的退场动画期间）。
 *
 * 视图过渡的快照画在整个页面之上，会盖住对话框和抽屉；所以有弹层时，
 * 弹层下面的列表不做过渡，直接更新（见 transitions.tsx 的 ItemTransition）。
 */
let open = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 弹层内容组件调用：挂载期间计入，卸载（退场动画结束）后移除。 */
export function useOverlayPresence(): void {
  useEffect(() => {
    open += 1;
    for (const listener of listeners) listener();
    return () => {
      open -= 1;
      for (const listener of listeners) listener();
    };
  }, []);
}

export function useOverlayOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open > 0,
    () => false,
  );
}
