"use client";

import { useCallback, useRef } from "react";

/**
 * 编程式打开的 Radix Dialog / Drawer 的焦点恢复（ORB-002，docs/02 §6）。
 *
 * docs/02 要求弹层「关闭后恢复焦点」。Radix 默认会把焦点还给 DialogTrigger，
 * 但当弹层由 React 状态编程式打开（无 Trigger 元素）时，Radix 在 Content 挂载
 * 后才捕获「上一个焦点元素」，此时焦点往往已离开触发元素，导致 Escape / 点击
 * 遮罩关闭后 document.activeElement 掉回 <body>。
 *
 * 本 hook 在「打开弹层的那一刻」同步记录当前焦点元素，并在 onCloseAutoFocus
 * 回调中把焦点精确还回去，从而覆盖无 Trigger 的编程式场景。
 *
 * 用法：
 * ```tsx
 * const { captureFocus, handleCloseAutoFocus } = useFocusReturn();
 * const open = () => { captureFocus(); setOpen(true); };
 * <DialogContent onCloseAutoFocus={handleCloseAutoFocus}>…</DialogContent>
 * ```
 */
export function useFocusReturn<T extends HTMLElement = HTMLElement>() {
  const returnFocusRef = useRef<T | null>(null);

  /** 打开弹层前同步调用：记录当前 document.activeElement 作为回归目标。 */
  const captureFocus = useCallback(() => {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? (active as T) : null;
  }, []);

  /** 传给 DialogContent / DrawerContent 的 onCloseAutoFocus。 */
  const handleCloseAutoFocus = useCallback((event: Event) => {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    // 仅当记录的元素仍在文档中且可聚焦时才接管，否则交还 Radix 默认行为。
    if (target && target.isConnected) {
      event.preventDefault();
      target.focus();
    }
  }, []);

  return { returnFocusRef, captureFocus, handleCloseAutoFocus } as const;
}
