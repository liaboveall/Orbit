"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";

/**
 * Dialog（ORB-002，基于 @radix-ui/react-dialog）。
 *
 * 无障碍由 Radix 保证：焦点陷阱、打开时初始焦点移入面板、关闭后焦点恢复触发元素、
 * Escape 关闭、aria-labelledby/aria-describedby 关联标题与描述。
 * 弹层圆角 rounded-overlay(16)、shadow-overlay（docs/02：影子只用于悬浮层）。
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

export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-40 bg-overlay",
        className,
      )}
      {...props}
    />
  );
}

export function DialogContent({
  children,
  closeLabel = "关闭对话框",
  className,
  onEscapeKeyDown,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2",
          "rounded-overlay border border-line bg-surface p-6 shadow-overlay",
          "max-h-[85vh] overflow-y-auto",
          className,
        )}
        {...props}
        onEscapeKeyDown={(event) => {
          // Closing the top layer can synchronously install the parent layer's
          // document listener. Do not let that listener handle this same Escape.
          event.stopImmediatePropagation();
          onEscapeKeyDown?.(event);
        }}
      >
        {children}
        <DialogPrimitive.Close asChild>
          <IconButton
            label={closeLabel}
            size="sm"
            className="absolute right-3 top-3"
          >
            <X className="h-4 w-4" />
          </IconButton>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  className,
  ...props
}: ComponentProps<"div">) {
  return <div className={cn("mb-4 space-y-2 pr-8", className)} {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-section font-semibold text-foreground", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-label text-foreground-secondary", className)}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn("mt-6 flex flex-wrap justify-end gap-3", className)}
      {...props}
    />
  );
}
