"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Button, EmptyState, InlineError } from "@/components/ui";

/** 区块内的读取失败：错误说明加一个真实的重试。 */
export function ErrorPanel({
  message,
  onRetry,
  retryLabel = "重新加载",
  draftNote,
  className,
}: {
  message: ReactNode;
  /** 重新读取的回调；不传则只显示错误说明。 */
  onRetry?: () => void;
  retryLabel?: string;
  /** 草稿仍然保留的说明。 */
  draftNote?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className} role="alert">
      <InlineError className="mb-2">{message}</InlineError>
      <div className="flex flex-wrap items-center gap-3">
        {onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RotateCw className="h-4 w-4" aria-hidden="true" />
            {retryLabel}
          </Button>
        ) : null}
        {draftNote ? <p className="text-caption text-foreground-muted">{draftNote}</p> : null}
      </div>
    </div>
  );
}

/**
 * 路由错误边界的内容。`retry` 会重新读取这一段的服务端数据再渲染
 * （`reset` 只清掉错误状态，不发请求），所以服务恢复后点一次就能回来。
 * 不显示服务端的错误细节，error 只在开发时打印。
 */
export function RouteError({
  error,
  retry,
  message,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  message: string;
}) {
  if (process.env.NODE_ENV !== "production") console.error(error);
  return (
    <EmptyState
      className="mx-auto mt-10 max-w-lg"
      icon={<TriangleAlert className="h-6 w-6" />}
      title={<span role="alert">{message}</span>}
      description="这不会影响你已保存的数据。"
      action={
        <Button variant="secondary" onClick={retry}>
          <RotateCw className="h-4 w-4" aria-hidden="true" />
          重新加载
        </Button>
      }
    />
  );
}
