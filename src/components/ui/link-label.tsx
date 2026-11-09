"use client";

import { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * 导航链接的文字。私有页面都是动态渲染，服务端返回前旧页面会保持显示，
 * 这里让被点击的链接轻微脉动，立即反馈点击已生效。必须放在 <Link> 内部。
 */
export function LinkLabel({ className, ...props }: ComponentProps<"span">) {
  const { pending } = useLinkStatus();
  return <span className={cn(pending && "animate-pulse", className)} {...props} />;
}
