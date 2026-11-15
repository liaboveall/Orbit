"use client";

import { useEffect, useRef, useState } from "react";
import { createApiClient, ProjectSchema, type ProjectDTO } from "@/contracts";
import { onWake } from "@/lib/wake";
import { useShellToken } from "./live";

const api = createApiClient();
type State = { userId: string; projects: ProjectDTO[]; loading: boolean; error: boolean };

/** 页面保鲜的轮询不可用时的兜底间隔。 */
const FALLBACK_INTERVAL_MS = 60_000;

/**
 * 侧栏的最近项目。只存在这个组件实例里，每次都经过带鉴权的项目接口读取。
 *
 * 读取时机：挂载、换账号、手动重试、窗口重新获得焦点，以及页面保鲜的 shell 令牌变化
 * （可访问的项目集合或项目资料变了，见 ./live.tsx）。路由切换不重新读取。
 * 过期的响应经 AbortController 取消，不产生跨用户缓存。
 */
export function useRecentProjects(userId: string) {
  const [state, setState] = useState<State>({ userId, projects: [], loading: true, error: false });
  const [attempt, setAttempt] = useState(0);
  const shell = useShellToken();
  const inFlight = useRef<AbortController | undefined>(undefined);
  /** 当前账号的读取函数；令牌变化和兜底定时器通过它触发同一条读取路径。 */
  const reload = useRef<(() => void) | undefined>(undefined);

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
    reload.current = () => void refresh();
    void refresh();
    const stopWake = onWake(() => void refresh());
    return () => {
      disposed = true; inFlight.current?.abort(); reload.current = undefined;
      stopWake();
    };
  }, [userId, attempt]);

  // 令牌从一个值变成另一个值才重读；第一次拿到令牌不算变化（挂载时已经读过）。
  const seenShell = useRef<string | null>(null);
  useEffect(() => {
    const previous = seenShell.current;
    seenShell.current = shell;
    if (previous !== null && shell !== null && previous !== shell) reload.current?.();
  }, [shell]);

  // 轮询还没有结果（接口不可用）时才靠定时器。
  const polling = shell !== null;
  useEffect(() => {
    if (polling) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload.current?.();
    }, FALLBACK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [polling]);

  return { ...(state.userId === userId ? state : { projects: [], loading: true, error: false }),
    retry: () => setAttempt(value => value + 1) };
}
