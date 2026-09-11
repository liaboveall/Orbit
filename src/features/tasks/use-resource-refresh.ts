"use client";
import { useEffect } from "react";
/** Refresh remote rows without replacing editors or their local drafts. */
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
      timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      clearTimeout(initial);
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, revision]);
}
