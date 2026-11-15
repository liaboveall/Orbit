"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/** 正在输入文字的地方：单键快捷键不能抢走这里的按键。 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

/**
 * 页面级的单键快捷键（例如 N 新建、/ 搜索）。
 *
 * 只在「没有别的东西在等按键」时触发：不带 Ctrl / Meta / Alt，不在输入框里，不在输入法
 * 组字中，也没有打开的对话框、抽屉或菜单。因此不会覆盖浏览器和系统的快捷键。
 * 触发的控件应同时写上 `aria-keyshortcuts`，让辅助技术能读到。
 */
export function useHotkey(key: string, handler: () => void, enabled = true): void {
  const latest = useRef(handler);
  // 布局副作用：随提交同步更新，不受视图过渡推迟 useEffect 的影响。
  useLayoutEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() !== key.toLowerCase() || isTyping(event.target)) return;
      // Radix 的弹层打开时都带 data-state="open"；它们自己处理键盘。
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"]')) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, enabled]);
}
