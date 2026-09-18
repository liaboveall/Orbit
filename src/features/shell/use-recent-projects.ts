"use client";

import { useEffect, useRef, useState } from "react";
import { createApiClient, ProjectSchema, type ProjectDTO } from "@/contracts";

const api = createApiClient();
type State = { userId: string; projects: ProjectDTO[]; loading: boolean; error: boolean };

/**
 * Instance-local state only; every refresh passes through the authenticated project API.
 * 路由切换不触发重新拉取（OI-24）：新鲜度由 30s 轮询与 focus/visibility 恢复承担；
 * 换账号（userId 变化）或手动重试会重新加载。过期响应经 AbortController 取消，
 * 不产生跨用户缓存。
 */
export function useRecentProjects(userId: string) {
  const [state, setState] = useState<State>({ userId, projects: [], loading: true, error: false });
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    let disposed = false;
    async function refresh() {
      // 合并重叠刷新：进行中的请求先取消，过期响应不落 state。
      inFlight.current?.abort();
      const current = new AbortController();
      inFlight.current = current;
      try {
        const result = await api.getList("/projects", ProjectSchema, {
          query: { scope: "all", archived: "exclude", limit: 6 }, signal: current.signal,
        });
        if (disposed || current.signal.aborted) return;
        setState({ userId, projects: result.ok ? result.data : [], loading: false, error: !result.ok });
      } catch {
        if (!disposed && !current.signal.aborted)
          setState({ userId, projects: [], loading: false, error: true });
      }
    }
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    const timer = setInterval(onVisible, 30000);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true; inFlight.current?.abort(); clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, attempt]);
  return { ...(state.userId === userId ? state : { projects: [], loading: true, error: false }),
    retry: () => setAttempt(value => value + 1) };
}
