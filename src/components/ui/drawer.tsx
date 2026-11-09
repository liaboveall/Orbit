"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";

/**
 * Drawer：基于 Radix Dialog 的玻璃面板，复用焦点陷阱、Escape 与焦点恢复。
 * side="right" 用于任务详情（手机全屏），side="bottom" 用于手机导航。
 */

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export type DrawerContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  children: ReactNode;
  side?: "right" | "bottom";
  closeLabel?: string;
  /** 内容已有自己的关闭入口时隐藏默认按钮，仍由 Root 处理 Escape/遮罩关闭。 */
  showCloseButton?: boolean;
  className?: string;
};

const sideClass: Record<NonNullable<DrawerContentProps["side"]>, string> = {
  right:
    "inset-y-0 right-0 animate-sheet-right sm:inset-y-2 sm:right-2 sm:rounded-overlay",
  bottom:
    "inset-x-2 bottom-[max(8px,env(safe-area-inset-bottom))] max-h-[82dvh] animate-sheet-up rounded-overlay",
};

export function DrawerContent({
  children,
  side = "right",
  closeLabel = "关闭面板",
  showCloseButton = true,
  className,
  ...props
}: DrawerContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 animate-fade-in bg-overlay" />
      <DialogPrimitive.Content
        className={cn("glass-thick fixed z-50 flex flex-col", sideClass[side], className)}
        {...props}
      >
        {showCloseButton ? (
          <DialogPrimitive.Close asChild>
            <IconButton label={closeLabel} size="sm" className="absolute right-3 top-3 z-10">
              <X className="h-4 w-4" />
            </IconButton>
          </DialogPrimitive.Close>
        ) : null}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DrawerTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-label font-semibold text-foreground", className)}
      {...props}
    />
  );
}

/** 视觉隐藏但保留可访问名称的 Description。 */
export function DrawerDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn("sr-only", className)} {...props} />
  );
}
