"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** DropdownMenu（基于 Radix）：键盘导航、Escape 与焦点管理由 Radix 提供。 */

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

/** 菜单和下拉列表共用的浮层与选项外观。 */
export const menuSurface = "glass-menu z-50 animate-pop-in rounded-card p-1.5";
export const menuItem =
  "flex min-h-11 cursor-pointer select-none items-center gap-2.5 rounded-item px-3 text-label text-foreground outline-none sm:min-h-9 " +
  "transition-colors duration-100 data-[highlighted]:bg-surface-sunken " +
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-45";

export function DropdownMenuContent({
  className,
  sideOffset = 8,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-lens=""
        sideOffset={sideOffset}
        className={cn(menuSurface, "min-w-48 origin-[var(--radix-dropdown-menu-content-transform-origin)]", className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive = false,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  /** 不能轻易撤销的操作：红色文字，高亮时用浅红底。 */
  destructive?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(menuItem, destructive && "text-danger data-[highlighted]:bg-danger-soft", className)}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("px-3 py-1.5 text-caption font-medium text-foreground-muted", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn("mx-3 my-1 h-px bg-line", className)} {...props} />;
}
