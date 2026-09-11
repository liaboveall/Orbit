"use client";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export function useAutoRefresh() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  useEffect(() => {
    const refresh = () => {
      if (
        document.visibilityState !== "visible" ||
        document.querySelector(
          '[data-task-editing="true"], [data-task-saving="true"]',
        )
      )
        return;
      startTransition(() => router.refresh());
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
}
