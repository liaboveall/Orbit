"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { registerHistoryGuard } from "@/lib/history-guard";

type EditState = { dirty: boolean; pending: boolean };
const EditContext = createContext<Map<string, EditState> | null>(null);

const LEAVE_CONFIRM_MESSAGE = "有未保存的更改或进行中的操作，确定离开并放弃草稿？";

/**
 * 模块级草稿检查器注册表（B6 修复）。
 *
 * 背景：Provider 的离开守卫只覆盖链接点击 / 关闭 / 前进后退；`router.push` 等
 * **程序化导航**（侧栏「全部项目」按钮、个人菜单）绕过全部拦截直接卸载脏面板。
 * 注册表让任何调用方（含 Provider 之外的 shell 组件）通过 `confirmLeave()` 询问
 * 「当前是否有未保存草稿且用户未确认放弃」，统一一条确认通路。
 */
const confirmCheckers = new Set<() => boolean>();

function hasUnsavedEdits(): boolean {
  for (const check of confirmCheckers) {
    if (check()) return true;
  }
  return false;
}

/**
 * 询问是否可以离开：无未保存草稿 → true；有草稿 → 弹确认，用户确认放弃 → true。
 * 所有离开入口（链接点击、beforeunload、前进后退、程序化导航）共用这一条语义，
 * 草稿只保留在组件内存，不写 URL / 不进共享缓存。
 */
export function confirmLeave(): boolean {
  if (!hasUnsavedEdits()) return true;
  return window.confirm(LEAVE_CONFIRM_MESSAGE);
}

/** 程序化导航守卫：push/replace 前先 confirmLeave，用户取消则留在当前页。 */
export function useGuardedNavigate(): {
  push: (href: string) => void;
  replace: (href: string) => void;
} {
  const router = useRouter();
  return useMemo(
    () => ({
      push: (href: string) => {
        if (confirmLeave()) router.push(href);
      },
      replace: (href: string) => {
        if (confirmLeave()) router.replace(href);
      },
    }),
    [router],
  );
}

let providerCount = 0;
let removeLeaveListeners: (() => void) | undefined;
function releaseProvider() {
  if (--providerCount === 0) {
    removeLeaveListeners?.();
    removeLeaveListeners = undefined;
  }
}

/** Local edit scopes share one browser listener set, so nested forms confirm once. */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [edits] = useState(() => new Map<string, EditState>());
  useEffect(() => {
    if (providerCount++ > 0) return releaseProvider;
    const currentUrl = location.href;
    const currentHistoryState: unknown = history.state;
    const navigation = "navigation" in window && window.navigation instanceof EventTarget ? window.navigation : null;
    const unload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedEdits()) event.preventDefault();
    };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download") || link.href === location.href) return;
      if (!confirmLeave()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const traverse = (event: PopStateEvent) => {
      if (navigation) return;
      if (location.href === currentUrl || !hasUnsavedEdits()) return;
      if (!window.confirm(LEAVE_CONFIRM_MESSAGE)) {
        // popstate itself is not cancelable. Restore the current history entry
        // before App Router handles the traversal and unmounts the editors.
        event.stopImmediatePropagation();
        // Bypass Next's patched pushState: it dispatches ACTION_RESTORE and can
        // remount the very editor whose navigation was just canceled.
        History.prototype.pushState.call(history, currentHistoryState, "", currentUrl);
      }
    };
    const beforeTraverse = (event: Event) => {
      if (!event.cancelable || !("navigationType" in event) || event.navigationType !== "traverse" || !hasUnsavedEdits()) return;
      if (!window.confirm(LEAVE_CONFIRM_MESSAGE)) event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    navigation?.addEventListener("navigate", beforeTraverse);
    const unregister = registerHistoryGuard(traverse);
    document.addEventListener("click", navigate, true);
    removeLeaveListeners = () => {
      window.removeEventListener("beforeunload", unload);
      navigation?.removeEventListener("navigate", beforeTraverse);
      unregister();
      document.removeEventListener("click", navigate, true);
    };
    return releaseProvider;
  }, [edits]);
  return <EditContext value={edits}>{children}</EditContext>;
}

/**
 * 注册当前编辑器的草稿状态：dirty（有未保存输入）或 pending（保存/提交在途）任一为真
 * 即视为「不可静默离开」。同时写进所在 Provider 的上下文（作用域内查询）与模块级注册表
 * （跨组件 confirmLeave / useGuardedNavigate 查询）。保存成功后 dirty/pending 归 false，
 * 保护自动解除；卸载时全部注销。草稿只存在于组件内存。
 */
export function useUnsavedChanges(dirty: boolean, pending = false) {
  const edits = useContext(EditContext);
  const id = useId();
  useEffect(() => {
    edits?.set(id, { dirty, pending });
    return () => { edits?.delete(id); };
  }, [edits, id, dirty, pending]);
  useEffect(() => {
    const check = () => dirty || pending;
    confirmCheckers.add(check);
    return () => { confirmCheckers.delete(check); };
  }, [dirty, pending]);
  return () => [...(edits?.values() ?? [])].some((entry) => entry.dirty || entry.pending);
}
