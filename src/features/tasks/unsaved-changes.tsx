"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
 *
 * 草稿存放：评论、子任务等输入只在组件内存；任务标题/描述另在本机持久化以便刷新或
 * 崩溃后恢复（见 ./draft-storage）。用户确认离开即视为放弃：已注册的 discard 回调会
 * 删除对应的本机草稿，避免「确认放弃」的内容在下次编辑时复活。
 */
type Checker = { check: () => boolean; discard?: () => void };
const confirmCheckers = new Set<Checker>();
let confirmedUnload = false;

/** Only after an already-confirmed operation succeeds (e.g. session revocation). */
export function navigateAfterConfirmedLeave(href: string): void {
  confirmedUnload = true;
  try {
    window.location.assign(href);
  } catch (error) {
    confirmedUnload = false;
    throw error;
  }
}

function hasUnsavedEdits(): boolean {
  for (const { check } of confirmCheckers) {
    if (check()) return true;
  }
  return false;
}

/** 用户已确认离开：让仍有未保存内容的编辑器删除其本机草稿。 */
function discardUnsavedDrafts(): void {
  for (const { check, discard } of [...confirmCheckers]) {
    if (check()) discard?.();
  }
}

/**
 * 询问是否可以离开：无未保存草稿 → true；有草稿 → 弹确认，用户确认放弃 → true。
 * 只询问、不清理，供「确认后还需等待其它操作成功」的调用方使用（如退出登录：
 * 退出失败必须保留草稿，成功后再按用户清理）。
 */
export function confirmLeave(): boolean {
  if (!hasUnsavedEdits()) return true;
  return window.confirm(LEAVE_CONFIRM_MESSAGE);
}

/** 离开当前内容的导航：确认后立即放弃草稿（含本机持久化），取消则保持原状。 */
export function confirmLeaveAndDiscard(): boolean {
  if (!confirmLeave()) return false;
  discardUnsavedDrafts();
  return true;
}

/** 程序化导航守卫：push/replace 前先确认并放弃草稿，用户取消则留在当前页。 */
export function useGuardedNavigate(): {
  push: (href: string) => void;
  replace: (href: string) => void;
} {
  const router = useRouter();
  return useMemo(
    () => ({
      push: (href: string) => {
        if (confirmLeaveAndDiscard()) router.push(href);
      },
      replace: (href: string) => {
        if (confirmLeaveAndDiscard()) router.replace(href);
      },
    }),
    [router],
  );
}

/** 同一页面（路径与查询相同，仅 hash 不同）之间的跳转不会卸载编辑器。 */
function samePage(a: string, b: string): boolean {
  try {
    const left = new URL(a, location.href);
    const right = new URL(b, location.href);
    return left.origin === right.origin && left.pathname === right.pathname && left.search === right.search;
  } catch {
    return false;
  }
}

/**
 * 当前所在的历史条目（DRAFT-HISTORY 修复）：每次导航提交后更新，而不是只在第一个
 * Provider 挂载时捕获。兼容后退路径据此判断「是否真的离开」并在取消时恢复正确条目。
 */
let activeEntry: { url: string; state: unknown } | null = null;
function recordActiveEntry(): void {
  activeEntry = { url: location.href, state: history.state as unknown };
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
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    // 导航提交（含过滤参数、打开/关闭面板）后记录新的当前条目。
    recordActiveEntry();
  }, [pathname, search]);
  useEffect(() => {
    if (providerCount++ > 0) return releaseProvider;
    recordActiveEntry();
    const navigation = "navigation" in window && window.navigation instanceof EventTarget ? window.navigation : null;
    const unload = (event: BeforeUnloadEvent) => {
      if (confirmedUnload) { confirmedUnload = false; return; }
      // 刷新/关闭标签页保留本机草稿，供重新打开时恢复。
      if (hasUnsavedEdits()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download") || samePage(link.href, location.href)) return;
      if (!confirmLeaveAndDiscard()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // 离开本应用的整页跳转已确认过一次，不再触发 beforeunload 二次确认。
      if (link.origin !== location.origin) confirmedUnload = true;
    };
    const traverse = (event: PopStateEvent) => {
      if (navigation) return;
      const from = activeEntry;
      if (!from || samePage(location.href, from.url) || !hasUnsavedEdits()) return;
      if (!window.confirm(LEAVE_CONFIRM_MESSAGE)) {
        // popstate itself is not cancelable. Restore the entry the user was on
        // before App Router handles the traversal and unmounts the editors.
        event.stopImmediatePropagation();
        // Bypass Next's patched pushState: it dispatches ACTION_RESTORE and can
        // remount the very editor whose navigation was just canceled.
        History.prototype.pushState.call(history, from.state, "", from.url);
        return;
      }
      discardUnsavedDrafts();
    };
    const beforeTraverse = (event: Event) => {
      if (!event.cancelable || !("navigationType" in event) || event.navigationType !== "traverse" || !hasUnsavedEdits()) return;
      if (!window.confirm(LEAVE_CONFIRM_MESSAGE)) event.preventDefault();
      else discardUnsavedDrafts();
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
 * 保护自动解除；卸载时全部注销。onDiscard 在用户确认离开时调用，用于删除本机持久化草稿。
 */
export function useUnsavedChanges(dirty: boolean, pending = false, onDiscard?: () => void) {
  const edits = useContext(EditContext);
  const id = useId();
  useEffect(() => {
    edits?.set(id, { dirty, pending });
    return () => { edits?.delete(id); };
  }, [edits, id, dirty, pending]);
  useEffect(() => {
    const checker: Checker = { check: () => dirty || pending, discard: onDiscard };
    confirmCheckers.add(checker);
    return () => { confirmCheckers.delete(checker); };
  }, [dirty, pending, onDiscard]);
  return () => [...(edits?.values() ?? [])].some((entry) => entry.dirty || entry.pending);
}
