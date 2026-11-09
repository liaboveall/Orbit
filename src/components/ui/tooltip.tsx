"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Tooltip（ORB-002，基于 @radix-ui/react-tooltip）。
 *
 * docs/02 §4：侧栏收窄(72px)与长项目名截断时保留完整标签的 tooltip/可访问名称。
 * Radix 保证 hover 与键盘 focus 均可触发，并管理 aria。Provider 在 AppShell 挂载一次。
 */

export function TooltipProvider({
  children,
  delayDuration = 200,
}: {
  children: ReactNode;
  delayDuration?: number;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export type TooltipProps = Omit<
  ComponentProps<typeof TooltipPrimitive.Trigger>,
  "content" | "children"
> & {
  /** 提示内容（同时作为无障碍补充说明）。 */
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
};

export function Tooltip({
  content,
  side = "top",
  children,
  className,
  ...triggerProps
}: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild {...triggerProps}>
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className={cn(
            "z-50 max-w-64 animate-pop-in rounded-full bg-tooltip px-3 py-1.5 text-caption text-tooltip-foreground shadow-popover backdrop-blur-md",
            className,
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
