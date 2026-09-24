"use client";

import { RotateCw } from "lucide-react";

/**
 * 工作台错误边界（N01 修复 + B2）。
 *
 * N01 关键修正：`retry` 是 Next 16.3 error 约定的重取动作（re-fetch 本段 RSC 并
 * 重新渲染边界）；此前使用的 `reset` 只清空错误状态、**不会**发起新请求，导致
 * 「重新加载」按钮在服务端数据恢复后仍显示旧错误。已安装运行时依据：
 * node_modules/next/dist/client/components/error-boundary.js（reset 仅 setState，
 * retry 执行 context.refresh）；随包文档 error.md 自 v16.3.0 说明 retry 稳定。
 */
export default function ErrorPage({
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
    <div className="space-y-4 p-8">
      <p role="alert">工作台加载失败，请稍后重试。</p>
      <button
        type="button"
        onClick={retry}
        className="inline-flex items-center gap-2 rounded-control border border-line px-4 py-2 outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <RotateCw className="h-4 w-4" aria-hidden="true" />
        重新加载
      </button>
    </div>
  );
}
