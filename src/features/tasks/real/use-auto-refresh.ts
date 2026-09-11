"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export type UseAutoRefreshOptions = {
  /** 
   * Refresh interval in milliseconds. Default: 30000 (30s)
   * Set to null/undefined to disable polling timer (manual only)
   */
  interval?: number | null;
  
  /** 
   * Enable/disable auto-refresh. Default: true
   * When false, only manual refresh triggers via onFocus/onVisibilityChange remain active
   */
  enabled?: boolean;
  
  /** 
   * Callback when refresh is triggered (before navigation starts)
   */
  onBeforeRefresh?: () => void;
  
  /** 
   * Callback when refresh fails with an error
   */
  onRefreshFailure?: (error: Error) => void;
  
  /** 
   * Custom elements to exclude from refresh during editing
   * Default: '[data-task-editing="true"], [data-task-saving="true"]'
   */
  editingSelectors?: string;
};

/**
 * Auto-refresh hook for Next.js App Router
 * 
 * Features:
 * - Periodic polling (default 30s configurable)
 * - Focus detection (window.focus event)
 * - Visibility change detection (tab switching)
 * - Smart skip during user editing sessions
 * - React transitions for non-blocking refreshes
 * - Memory leak safe (proper cleanup)
 * 
 * @param options - Configuration options
 * @example
 * ```tsx
 * // Basic usage (30s default interval)
 * useAutoRefresh();
 * 
 * // With custom config
 * useAutoRefresh({
 *   interval: 60000,  // 1 minute
 *   enabled: true,
 *   onBeforeRefresh: () => console.log('Refreshing...'),
 * });
 * 
 * // Manual mode only (no polling)
 * useAutoRefresh({ interval: null });
 * ```
 */
export function useAutoRefresh(options?: UseAutoRefreshOptions) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  
  const {
    interval = 30000,
    enabled = true,
    onBeforeRefresh,
    onRefreshFailure,
    editingSelectors = '[data-task-editing="true"], [data-task-saving="true"]',
  } = options ?? {};

  useEffect(() => {
    if (!enabled) return;

    const refresh = () => {
      // Check if user is actively editing tasks
      const editingElement = document.querySelector(editingSelectors);
      if (document.visibilityState !== "visible" || editingElement) {
        return;
      }
      
      onBeforeRefresh?.();
      
      try {
        startTransition(() => {
          router.refresh();
        });
      } catch (error) {
        if (error instanceof Error) {
          onRefreshFailure?.(error);
        } else {
          onRefreshFailure?.(new Error(String(error)));
        }
      }
    };

    let timerId: ReturnType<typeof setInterval> | null = null;

    if (interval !== null && interval !== undefined) {
      // Only set up timer if not explicitly disabled
      timerId = setInterval(refresh, interval);
    }

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      if (timerId) clearInterval(timerId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, enabled, interval, editingSelectors, onBeforeRefresh, onRefreshFailure]);
}
