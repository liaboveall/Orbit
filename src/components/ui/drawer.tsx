"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";

/**
 * Drawer（ORB-002）：侧滑面板，基于 Radix Dialog 复用其焦点陷阱/Escape/焦点恢复。
 *
 * docs/02 §4：<768 顶部汉堡按钮打开抽屉导航；任务详情在手机端占满屏亦可用此。
 * side="left" 用于导航抽屉，side="right" 用于详情侧面板。
 */

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export type DrawerContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  children: ReactNode;
  side?: "left" | "right";
  closeLabel?: string;
  /** 内容已有自己的关闭入口时隐藏默认按钮，仍由 Root 处理 Escape/遮罩关闭。 */
  showCloseButton?: boolean;
  className?: string;
};

export function DrawerContent({
  children,
  side = "left",
  closeLabel = "关闭面板",
  showCloseButton = true,
  className,
  ...props
}: DrawerContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-0 z-50 flex h-dvh w-[min(85vw,320px)] flex-col bg-surface shadow-overlay",
          side === "left" ? "left-0 border-r border-line" : "right-0 border-l border-line",
          className,
        )}
        {...props}
      >
        {showCloseButton ? (
          <DialogPrimitive.Close asChild>
            <IconButton
              label={closeLabel}
              size="sm"
              className="absolute right-3 top-3"
            >
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

/** 视觉隐藏但保留可访问名称的 Description（Radix 会告警缺少 Description 时用它）。 */
export function DrawerDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("sr-only", className)}
      {...props}
    />
  );
}
