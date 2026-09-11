"use client";

import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { registerHistoryGuard } from "@/lib/history-guard";

type EditState = { dirty: boolean; pending: boolean };
const EditContext = createContext<Map<string, EditState> | null>(null);

/** Scoped to a single user's task detail; no drafts enter shared storage. */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [edits] = useState(() => new Map<string, EditState>());
  useEffect(() => {
    const currentUrl = location.href;
    const currentHistoryState: unknown = history.state;
    const navigation = "navigation" in window && window.navigation instanceof EventTarget ? window.navigation : null;
    const hasChanges = () => [...edits.values()].some((entry) => entry.dirty || entry.pending);
    const unload = (event: BeforeUnloadEvent) => {
      if (hasChanges()) event.preventDefault();
    };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download") || link.href === location.href) return;
      if (hasChanges() && !window.confirm("有未保存的更改或进行中的操作，确定离开并放弃草稿？")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const traverse = (event: PopStateEvent) => {
      if (navigation) return;
      if (location.href === currentUrl || !hasChanges()) return;
      if (!window.confirm("有未保存的更改或进行中的操作，确定离开并放弃草稿？")) {
        // popstate itself is not cancelable. Restore the current history entry
        // before App Router handles the traversal and unmounts the editors.
        event.stopImmediatePropagation();
        // Bypass Next's patched pushState: it dispatches ACTION_RESTORE and can
        // remount the very editor whose navigation was just canceled.
        History.prototype.pushState.call(history, currentHistoryState, "", currentUrl);
      }
    };
    const beforeTraverse = (event: Event) => {
      if (!event.cancelable || !("navigationType" in event) || event.navigationType !== "traverse" || !hasChanges()) return;
      if (!window.confirm("有未保存的更改或进行中的操作，确定离开并放弃草稿？")) event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    navigation?.addEventListener("navigate", beforeTraverse);
    const unregister = registerHistoryGuard(traverse);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      navigation?.removeEventListener("navigate", beforeTraverse);
      unregister();
      document.removeEventListener("click", navigate, true);
    };
  }, [edits]);
  return <EditContext value={edits}>{children}</EditContext>;
}

export function useUnsavedChanges(dirty: boolean, pending = false) {
  const edits = useContext(EditContext);
  const id = useId();
  useEffect(() => {
    edits?.set(id, { dirty, pending });
    return () => { edits?.delete(id); };
  }, [edits, id, dirty, pending]);
  return () => [...(edits?.values() ?? [])].some((entry) => entry.dirty || entry.pending);
}
