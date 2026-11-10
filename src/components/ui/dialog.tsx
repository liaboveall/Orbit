"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";

/**
 * Dialog（基于 Radix）。焦点陷阱、初始焦点、关闭后恢复焦点和 Escape 由 Radix 保证。
 * 桌面居中，手机从底部升起。只做入场动画，关闭立即卸载。
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export type DialogContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  children: ReactNode;
  /** 关闭按钮的可访问名称。 */
  closeLabel?: string;
  className?: string;
};

export function DialogContent({
  children,
  closeLabel = "关闭对话框",
  className,
  onEscapeKeyDown,
  ...props
}: DialogContentProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const dialog = closeRef.current?.closest('[role="dialog"]');
      // Radix 1.1.23 在嵌套对话框打开后可能保留父抽屉的 Escape 监听，
      // 所以在 document 捕获阶段之前按焦点所在层分发。对话框里的菜单和下拉仍自己处理 Escape。
      const layer = event.target instanceof Element
        ? event.target.closest('[role="dialog"], [role="menu"], [role="listbox"]')
        : null;
      if (!dialog || layer !== dialog) return;
      // 输入法组字时的 Escape 只取消候选，不关闭对话框，也不让父层收到。
      if (event.isComposing || event.keyCode === 229) { event.stopImmediatePropagation(); return; }
      event.stopImmediatePropagation();
      onEscapeKeyDown?.(event);
      if (!event.defaultPrevented) {
        event.preventDefault();
        closeRef.current?.click();
      }
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [onEscapeKeyDown]);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 animate-fade-in bg-overlay" />
      <DialogPrimitive.Content
        className={cn(
          "glass-thick fixed z-50 max-h-[88dvh] overflow-y-auto overscroll-contain rounded-panel p-6",
          // 手机：底部升起
          "inset-x-2 bottom-[max(8px,env(safe-area-inset-bottom))] animate-sheet-up",
          // 桌面：居中
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100vw-32px)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:animate-dialog-in",
          className,
        )}
        {...props}
        onEscapeKeyDown={(event) => {
          if (event.isComposing || event.keyCode === 229) { event.preventDefault(); return; }
          onEscapeKeyDown?.(event);
        }}
      >
        {children}
        <DialogPrimitive.Close asChild>
          <IconButton ref={closeRef} label={closeLabel} size="sm" className="absolute right-3.5 top-3.5 bg-surface-sunken">
            <X className="h-4 w-4" />
          </IconButton>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mb-5 space-y-1.5 pr-10", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-section font-semibold tracking-[-0.015em] text-foreground", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-label leading-relaxed text-foreground-secondary", className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mt-6 flex flex-wrap justify-end gap-2", className)} {...props} />;
}
