"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loginPathWithReturnTo } from "@/lib/return-to";

export type PermissionLossReason = "removed" | "expired" | "revoked";

export type UsePermissionLossOptions = {
  /** 
   * Project ID to monitor for permission changes
   */
  projectId: string;
  
  /** 
   * Callback when permission loss is detected
   */
  onLoss?: (reason: PermissionLossReason) => void;
  
  /** 
   * Delay before checking permissions after mount (ms)
   */
  checkDelay?: number;
};

/**
 * Hook to detect and handle user permission loss in real-time
 * 
 * Monitors the current page for permission-related errors and triggers
 * appropriate handling when user loses access to a project.
 * 
 * @param options - Configuration options
 * @example
 * ```tsx
 * function ActivityPage() {
 *   usePermissionLossHandler({
 *     projectId: projectId,
 *     onLoss: (reason) => {
 *       if (reason === 'removed') {
 *         // Show toast notification before redirecting
 *         toast.error("你已不再属于此项目");
 *       }
 *     },
 *   });
 *   
 *   return <ActivityFeed ... />;
 * }
 * ```
 */
export function usePermissionLossHandler(options: UsePermissionLossOptions) {
  const {
    projectId,
    onLoss,
    checkDelay = 1000,
  } = options;
  
  const router = useRouter();
  
  const [hasPermissionError, setHasPermissionError] = useState(false);
  const [permissionLossReason, setPermissionLossReason] = useState<PermissionLossReason | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    // Initial delay to allow page to hydrate
    const timeoutId = setTimeout(() => {
      setIsChecking(false);
    }, checkDelay);

    return () => clearTimeout(timeoutId);
  }, [checkDelay]);

  useEffect(() => {
    if (!hasPermissionError) return;

    const handleRedirect = async () => {
      // Small delay to allow UI to show error message
      await new Promise(resolve => setTimeout(resolve, 300));

      onLoss?.(permissionLossReason ?? "removed");
      
      // Redirect to login with return URL
      const returnUrl = `/app/projects/${projectId}`;
      void router.replace(loginPathWithReturnTo(returnUrl));
    };

    handleRedirect();
  }, [hasPermissionError, permissionLossReason, onLoss, projectId, router]);

  /**
   * Check if the current request resulted in a permission error
   * Call this from your data fetching code when you receive a 401 response
   */
  const handlePermissionError = (error: Error, reason: PermissionLossReason = "removed"): void => {
    console.warn(`[Permission Loss Handler] ${reason} for project ${projectId}`, error.message);
    
    setPermissionLossReason(reason);
    setHasPermissionError(true);
  };

  /**
   * Clear permission error state (useful for navigation away and back)
   */
  const clearPermissionError = (): void => {
    setHasPermissionError(false);
    setPermissionLossReason(null);
  };

  return {
    hasPermissionError,
    permissionLossReason,
    isChecking,
    handlePermissionError,
    clearPermissionError,
  };
}

/**
 * Component wrapper that displays permission loss recovery UI
 * Can be used as an overlay or inline message
 */
export function PermissionLossOverlay({
  projectId,
  isVisible,
  onDismiss,
}: {
  projectId: string;
  isVisible: boolean;
  onDismiss: () => void;
}) {
  const router = useRouter();

  if (!isVisible) return null;

  const handleLoginNow = () => {
    const returnUrl = `/app/projects/${projectId}`;
    void router.push(loginPathWithReturnTo(returnUrl));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-loss-title"
    >
      <div className="mx-4 max-w-md rounded-lg bg-surface p-6 shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <svg
            className="h-8 w-8 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h3 id="permission-loss-title" className="text-xl font-semibold text-page">
            访问权限失效
          </h3>
        </div>

        <p className="mb-6 text-foreground-secondary">
          您当前的操作权限已失效，可能是因为您已被移出该项目的成员列表。请重新登录以确认您的账户状态。
        </p>

        <div className="flex justify-end gap-3">
          <button
            onClick={onDismiss}
            className="rounded-md border px-4 py-2 text-label hover:bg-surface-secondary"
          >
            稍后处理
          </button>
          <button
            onClick={handleLoginNow}
            className="rounded-md bg-brand px-4 py-2 text-white hover:bg-brand-hover"
          >
            立即登录
          </button>
        </div>
      </div>
    </div>
  );
}
