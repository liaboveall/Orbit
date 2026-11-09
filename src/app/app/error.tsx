"use client";

import { RotateCw } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/**
 * /app 段错误边界（B2 修复）：覆盖工作台之外的 /app/* 子页（项目列表/详情、
 * 任务、看板、成员、邀请、活动、设置等）的意外渲染/读取错误。
 *
 * - N01 修复同源：`retry` 是 Next 16.3 error 约定提供的重取动作（re-fetch RSC +
 *   重新渲染边界），比 `reset`（仅清错误状态）多一次真实网络重取，故障恢复才会
 *   发出新请求。本地文档：node_modules/next/dist/docs/.../error.md（retry 自 v16.3.0 稳定）。
 * - 文案保持中文且不泄露服务端错误细节；error 对象只在开发期打印。
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  if (process.env.NODE_ENV !== "production") {
    console.error(error);
  }
  return (
    <div className="mx-auto mt-16 max-w-lg space-y-4 p-4 text-center">
      <p role="alert" className="text-label font-medium text-foreground">
        页面加载失败，请稍后重试。
      </p>
      <p className="text-caption text-foreground-muted">
        这不会影响你已保存的数据。
      </p>
      <button
        type="button"
        onClick={retry}
        className={buttonVariants({ variant: "secondary" })}
      >
        <RotateCw className="h-4 w-4" aria-hidden="true" />
        重新加载
      </button>
    </div>
  );
}
