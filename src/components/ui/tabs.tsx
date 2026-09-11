"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Tabs（ORB-002，基于 @radix-ui/react-tabs）。
 *
 * 用于项目二级导航（看板/列表/活动/设置）与手机看板的按状态切换。
 * Radix 提供方向键切换、Home/End、aria-selected/role=tablist 等完整键盘与语义。
 */

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "flex items-center gap-1 overflow-x-auto border-b border-line",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "relative -mb-px shrink-0 whitespace-nowrap px-3 py-2 text-label font-medium text-foreground-secondary outline-none",
        "border-b-2 border-transparent transition-[color,border-color] duration-150 ease-standard",
        "hover:text-foreground",
        "data-[state=active]:border-brand data-[state=active]:text-brand",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("pt-4 outline-none", className)}
      {...props}
    />
  );
}
