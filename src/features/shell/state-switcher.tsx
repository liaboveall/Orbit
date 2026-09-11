"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import {
  parseSampleState,
  SAMPLE_STATES,
  SAMPLE_STATE_LABELS,
  SAMPLE_STATE_HINTS,
  type SampleState,
} from "./sample-state";

/**
 * 六态切换面板（ORB-002，仅开发样例）。
 *
 * 固定在左下角（避开右下角 Toast），点击通过 router.replace 改写 `?state=`，
 * 保留其它查询参数（如看板的 ?task=）。不使用 useSearchParams，以免触发 Next
 * 对静态预渲染的 Suspense 降级；改以 useSyncExternalStore 把浏览器 URL 当作外部
 * 数据源订阅（popstate 通知前进/后退，导航重渲染会重读快照），避免在 effect 内
 * 同步 setState。SSR 快照为空 → 默认「data」态，无水合不一致。
 *
 * 双重生产门禁：1) 父级 layout.tsx 已通过 NODE_ENV check 消除渲染分支;
 *   2) 本组件运行时再次检查，确保绝对不可能在生产环境出现。
 */

function subscribeToUrl(callback: () => void): () => void {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}
function getUrlSearch(): string {
  return window.location.search;
}
function getUrlSearchOnServer(): string {
  return "";
}

export function StateSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  
  // Hooks must be called BEFORE any early returns (Rules of Hooks)
  const [collapsed, setCollapsed] = useState(false);
  // 仅用于在 router.replace 后立即重渲染，使 useSyncExternalStore 重读 URL 快照；
  // 导航本身也会重渲染本组件（消费 useRouter/usePathname），作为兜底。
  const [, bumpRender] = useState(0);

  const search = useSyncExternalStore(
    subscribeToUrl,
    getUrlSearch,
    getUrlSearchOnServer,
  );
  const active = parseSampleState(
    new URLSearchParams(search).get("state") ?? undefined,
  );

  const goTo = useCallback(
    (state: SampleState) => {
      const params = new URLSearchParams(window.location.search);
      if (state === "data") params.delete("state");
      else params.set("state", state);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
      bumpRender((n) => n + 1);
    },
    [router, pathname],
  );

  // Runtime guard for production - double layer of safety
  // Check conditions AFTER all hooks have been called
  const samplePage = pathname.startsWith('/app/samples/') || pathname === '/app/today' || pathname === '/app/ui-samples';
  if (process.env.NODE_ENV !== 'development' || !samplePage) {
    return null;
  }

  return (
    <div
      className="fixed bottom-4 left-4 z-30 w-60 rounded-overlay border border-line bg-surface p-3 shadow-overlay"
      aria-label="M0 样例六态切换"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-caption font-semibold text-foreground">
          六态切换（开发样例）
        </p>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="rounded-control px-1.5 text-caption text-foreground-secondary outline-none hover:bg-surface-sunken"
        >
          {collapsed ? "展开" : "收起"}
        </button>
      </div>

      {!collapsed ? (
        <div className="flex flex-wrap gap-1.5">
          {SAMPLE_STATES.map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => goTo(state)}
              title={SAMPLE_STATE_HINTS[state]}
              aria-pressed={active === state}
              className={cn(
                "rounded-control px-2 py-1 text-caption font-medium outline-none transition-colors duration-150 ease-standard",
                active === state
                  ? "bg-brand text-foreground-invert"
                  : "bg-surface-sunken text-foreground-secondary hover:text-foreground",
              )}
            >
              {SAMPLE_STATE_LABELS[state]}
            </button>
          ))}
          <p className="mt-1 w-full text-caption text-foreground-muted">
            第六态「手机」：把浏览器宽度调到 390px 查看。
          </p>
        </div>
      ) : null}
    </div>
  );
}
