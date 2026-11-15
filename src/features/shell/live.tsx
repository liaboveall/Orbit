"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useSyncExternalStore, useTransition } from "react";
import { onWake } from "@/lib/wake";
import { isOutdated, parsePulse, type Pulse, type PulseScope } from "./pulse";

/**
 * 页面保鲜：一个标签页只跑一个轻量轮询，数据真的变了才让服务端组件重读。
 *
 * 服务端的 `GET /api/v1/my/pulse` 为当前用户能看到的每个项目返回一个变更令牌
 * （任何成员可见的写入都会让它变化），请求带 `If-None-Match`，没变化时是一个空的 304。
 * 页面由服务端渲染时带上「读取数据之前」取的令牌（`<LiveScope seed>`）；之后轮询到的令牌
 * 与它不同，就说明页面上的数据过期了，调用一次 `router.refresh()`，新的渲染带回新的令牌。
 *
 * 这取代了原来每 30 秒无条件整页重读、外加每个子列表各自轮询的做法：空闲时每次检查只是
 * 一条 SQL，变化则在约 10 秒内出现在所有成员的页面上。
 *
 * 保留的兜底：
 *  - 窗口重新获得焦点或标签页重新可见时无条件重读一次（令牌看不到的变化，如队友改名）；
 *  - 每 5 分钟无条件重读一次；
 *  - 轮询连续失败（接口不可用）时退回每 30 秒重读。
 * 正在编辑或保存时不打扰（`data-task-editing` / `data-task-saving`），稍后再试。
 */

const ENDPOINT = "/api/v1/my/pulse";
const POLL_MS = 10_000;
const POLL_JITTER_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;
const FALLBACK_REFRESH_MS = 30_000;
const SAFETY_REFRESH_MS = 5 * 60_000;
const BUSY_RETRY_MS = 2_000;
const BUSY_SELECTOR = '[data-task-editing="true"], [data-task-saving="true"]';

/* ── 模块级状态：一个标签页一份 ─────────────────────────────────────────────── */

/** 最近一次轮询到的令牌。 */
let latest: Pulse | null = null;
/** 当前页面上的数据所对应的令牌（来自服务端渲染，或刚发起的那次重读）。 */
let applied: Pulse | null = null;
/** 连续失败次数；达到 3 次视为接口不可用，退回定时重读。被限流（429）不算失败。 */
let failures = 0;
/** 这份状态属于哪个账号；只有在同一个文档里换了账号才清空。 */
let owner: string | null = null;
const scopes = new Set<PulseScope>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type PollOutcome = "ok" | "unauthenticated" | { retryAfterMs: number } | "failed";

async function poll(signal: AbortSignal): Promise<PollOutcome> {
  const response = await fetch(ENDPOINT, {
    credentials: "same-origin",
    cache: "no-store",
    headers: latest ? { "If-None-Match": `"${latest.token}"` } : undefined,
    signal,
  });
  if (response.status === 304) return "ok";
  if (response.status === 401) return "unauthenticated";
  if (response.status === 429) {
    const seconds = Number(response.headers.get("retry-after"));
    return { retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : POLL_MS };
  }
  if (!response.ok) return "failed";
  const pulse = parsePulse(await response.json());
  if (!pulse) return "failed";
  latest = pulse;
  // 没有服务端令牌可比时（接口刚上线的旧渲染），第一次轮询的结果就是基线。
  applied ??= pulse;
  emit();
  return "ok";
}

/* ── Provider：轮询和重读都在这里，全应用只挂一次 ───────────────────────────── */

export function LiveProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  useEffect(() => {
    // 换账号：上一个用户的令牌不能留给下一个。首次挂载不清空：子组件的 effect 先于这里执行，
    // 页面带来的服务端令牌（LiveScope seed）此时已经写入，清掉它就退回「以第一次轮询为基线」，
    // 会漏掉渲染之后、第一次轮询之前的变化。
    if (owner !== null && owner !== userId) {
      latest = null;
      applied = null;
      failures = 0;
      emit();
    }
    owner = userId;

    const controller = new AbortController();
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let inFlight = false;

    const refresh = (force: boolean) => {
      if (stopped || scopes.size === 0 || document.visibilityState !== "visible") return;
      if (!force && !isOutdated(latest, applied, scopes)) return;
      if (document.querySelector(BUSY_SELECTOR)) {
        // 用户正在编辑或保存：等一会儿再看还需不需要。
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => refresh(force), BUSY_RETRY_MS);
        return;
      }
      // 这次重读至少会反映到目前轮询到的状态；随后的服务端渲染带回更准确的令牌。
      if (latest) applied = latest;
      startTransition(() => router.refresh());
    };

    const schedule = (delay: number) => {
      clearTimeout(pollTimer);
      if (stopped) return;
      pollTimer = setTimeout(() => void tick(), delay);
    };

    const tick = async () => {
      if (stopped || inFlight) return;
      if (document.visibilityState !== "visible") return; // 重新可见时再开始
      inFlight = true;
      let outcome: PollOutcome;
      try {
        outcome = await poll(controller.signal);
      } catch {
        outcome = "failed";
      }
      inFlight = false;
      if (stopped) return;
      if (outcome === "unauthenticated") return; // 会话没了：下一次操作会带用户去登录
      if (outcome === "ok") {
        failures = 0;
        refresh(false);
        schedule(POLL_MS + Math.random() * POLL_JITTER_MS);
        return;
      }
      if (typeof outcome === "object") {
        // 被限流：接口是好的，只是这个用户读得太多。按 Retry-After 退避，不计入失败，
        // 否则兜底的定时重读会继续消耗同一份读取额度，把用户带到限流说明页。
        schedule(outcome.retryAfterMs + Math.random() * POLL_JITTER_MS);
        return;
      }
      failures += 1;
      schedule(Math.min(POLL_MS * 2 ** failures, MAX_BACKOFF_MS) + Math.random() * POLL_JITTER_MS);
    };

    const stopWake = onWake(() => {
      refresh(true);
      void tick();
    });
    // 接口不可用时的兜底，和每隔几分钟的保险重读。
    const fallback = setInterval(() => {
      if (failures >= 3) refresh(true);
    }, FALLBACK_REFRESH_MS);
    const safety = setInterval(() => refresh(true), SAFETY_REFRESH_MS);

    void tick();

    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(pollTimer);
      clearTimeout(retryTimer);
      clearInterval(fallback);
      clearInterval(safety);
      stopWake();
    };
  }, [userId, router]);

  return children;
}

/* ── 页面声明自己关心的范围 ─────────────────────────────────────────────────── */

/**
 * 放在需要保鲜的页面里（服务端组件直接渲染它）。
 * `project` 省略表示关心当前用户可见的一切（工作台、项目列表）。
 * `seed` 是服务端在读取本页数据之前取的令牌：每次服务端渲染都带来新的一份。
 */
export function LiveScope({ project, seed }: { project?: string; seed?: Pulse | null }) {
  // 布局副作用：随提交同步生效。带视图过渡的提交要等动画结束才执行 useEffect，
  // 其间的轮询会拿旧令牌比较，白白多刷新一次。
  useLayoutEffect(() => {
    if (seed) applied = seed;
  }, [seed]);
  useEffect(() => {
    const scope: PulseScope = { project };
    scopes.add(scope);
    return () => {
      scopes.delete(scope);
    };
  }, [project]);
  return null;
}

/** 侧栏用：最近项目可能变化时这个值会变。轮询还没有结果时为 null。 */
export function useShellToken(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => latest?.shell ?? null,
    () => null,
  );
}
