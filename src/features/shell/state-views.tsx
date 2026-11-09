"use client";

import { RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button, InlineError } from "@/components/ui";

export function ErrorPanel({
  message,
  onRetry,
  retryLabel = "重新加载",
  draftNote,
  className,
}: {
  message: ReactNode;
  /** 真实的重新拉取回调；不传则只显示错误说明。 */
  onRetry?: () => void;
  retryLabel?: string;
  /** 草稿保留说明（可选）。 */
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
        {draftNote ? (
          <p className="text-caption text-foreground-muted">{draftNote}</p>
        ) : null}
      </div>
    </div>
  );
}
