"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Tooltip（基于 Radix）：悬停和键盘聚焦都能触发。
 * 用于收窄的侧栏和被截断的长名称。Provider 在 AppProviders 挂载一次。
 */

export function TooltipProvider({ children, delayDuration = 200 }: { children: ReactNode; delayDuration?: number }) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration}>{children}</TooltipPrimitive.Provider>;
}

export type TooltipProps = Omit<ComponentProps<typeof TooltipPrimitive.Trigger>, "content" | "children"> & {
  /** 提示内容，同时是无障碍的补充说明。 */
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
};

export function Tooltip({ content, side = "top", children, className, ...triggerProps }: TooltipProps) {
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
            "z-50 max-w-64 animate-pop-in rounded-full bg-tooltip px-3 py-1.5 text-caption text-tooltip-foreground shadow-[0_8px_24px_-8px_rgb(0_0_0/0.4)] backdrop-blur-md",
            className,
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
