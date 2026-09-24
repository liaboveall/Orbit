"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loginPathWithReturnTo } from "@/lib/return-to";
import { createApiClient, TaskSummarySchema, type TaskSummaryDTO } from "@/contracts";

const api = createApiClient();
type Query = Record<string, string | number | boolean | undefined>;

/** Refresh the already-read window using fresh cursors, never stale page responses. */
export function usePagedTasks(endpoint: string, context: string, query: Query, initial: TaskSummaryDTO[], cursor: string | null) {
  const router = useRouter();
  const queryKey = JSON.stringify(query);
  const identity = `${endpoint}:${context}:${queryKey}`;
  const [state, setState] = useState({ identity, source: initial, items: initial, cursor, target: initial.length, refreshing: false, busy: false, error: null as string | null });
  const abort = useRef<AbortController | null>(null);
  if (state.source !== initial || state.identity !== identity) {
    const target = state.identity === identity ? Math.max(state.target, state.items.length) : initial.length;
    const refreshing = target > initial.length && cursor !== null;
    // Preserve page height/reading position while the fresh window is in flight.
    const oldFirst = new Set(state.source.map((task) => task.id));
    const items = refreshing && state.identity === identity
      ? [...new Map([...initial, ...state.items.filter((task) => !oldFirst.has(task.id) && !initial.some((fresh) => fresh.id === task.id))].map((task) => [task.id, task])).values()]
      : initial;
    setState({ identity, source: initial, items, cursor, target, refreshing, busy: false, error: null });
  }
  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    if (state.refreshing) {
      void (async () => {
        try {
          let next = state.cursor;
          const items = [...state.source];
          while (next && items.length < state.target) {
            const result = await api.getList(endpoint, TaskSummarySchema, { query: { ...JSON.parse(queryKey) as Query, cursor: next }, signal: controller.signal });
            if (!result.ok) {
              if (result.status === 401) window.location.assign(loginPathWithReturnTo(location.pathname + location.search));
              if (result.status === 403 || result.status === 404) {
                if (!controller.signal.aborted) setState((prev) => ({ ...prev, items: [], cursor: null }));
                router.refresh();
              }
              // F11 修复：游标失效（如跨午夜后筛选指纹变化）→ 放弃旧窗口、回到首屏
              // 重新读取，绝不把不同日期窗口的结果拼接在一起。
              if (result.error.code === "INVALID_CURSOR") {
                if (!controller.signal.aborted) setState((prev) => ({ ...prev, items: prev.source, cursor: null, target: prev.source.length, refreshing: false }));
                router.refresh();
                return;
              }
              throw new Error(result.error.message);
            }
            items.push(...result.data);
            next = result.meta.nextCursor;
          }
          if (!controller.signal.aborted) setState((prev) => ({ ...prev, items: [...new Map(items.map((t) => [t.id, t])).values()], cursor: next, refreshing: false }));
        } catch (error) {
          if (!controller.signal.aborted) setState((prev) => ({ ...prev, refreshing: false, error: error instanceof Error ? error.message : "刷新失败，请重试。" }));
        }
      })();
    }
    return () => controller.abort();
  }, [state.source, state.identity, state.refreshing, state.target, state.cursor, endpoint, queryKey, router]);

  async function more() {
    if (state.busy || state.refreshing || !state.cursor) return;
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    setState((prev) => ({ ...prev, busy: true, error: null }));
    try {
      const result = await api.getList(endpoint, TaskSummarySchema, { query: { ...query, cursor: state.cursor }, signal: controller.signal });
      if (!result.ok) {
        if (result.status === 401) window.location.assign(loginPathWithReturnTo(location.pathname + location.search));
        if (result.status === 403 || result.status === 404) router.refresh();
        // F11 修复：旧游标失效 → 重置回首屏（router.refresh 拉新服务端 props），不卡死。
        if (result.error.code === "INVALID_CURSOR") {
          if (!controller.signal.aborted) setState((prev) => ({ ...prev, items: prev.source, cursor: null, target: prev.source.length, busy: false }));
          router.refresh();
          return;
        }
        throw new Error(result.error.message);
      }
      if (!controller.signal.aborted) setState((prev) => prev.source !== state.source || prev.identity !== state.identity ? prev : {
        ...prev, items: [...new Map([...prev.items, ...result.data].map((t) => [t.id, t])).values()], cursor: result.meta.nextCursor, target: Math.max(prev.target, prev.items.length + result.data.length), busy: false,
      });
    } catch (error) {
      if (!controller.signal.aborted) setState((prev) => ({ ...prev, busy: false, error: error instanceof Error ? error.message : "加载失败，请重试。" }));
    }
  }
  useEffect(() => () => abort.current?.abort(), [identity, initial]);
  return { tasks: state.items, cursor: state.cursor, busy: state.busy || state.refreshing, error: state.error, more };
}
