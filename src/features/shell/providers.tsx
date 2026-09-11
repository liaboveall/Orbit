"use client";

import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "@/components/ui/toast";

/**
 * 客户端 Provider 组合（ORB-002）。
 *
 * 在 /app 布局挂载一次：
 * - TooltipProvider: 工具提示需要 Provider 才能工作（侧栏收窄/长名截断的完整标签）
 * - ToastProvider: 供真实操作的瞬时提示（保存成功/版本冲突等）
 *
 * 数据真源说明：本项目采用「Server props（force-dynamic）+ 直接 createApiClient 调用
 * + router.refresh()」的单一数据真源模式，未使用 TanStack Query 作为第二套缓存真源。
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <TooltipProvider>{children}</TooltipProvider>
    </ToastProvider>
  );
}
