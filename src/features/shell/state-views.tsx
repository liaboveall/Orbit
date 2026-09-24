"use client";

import { Lock, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button, EmptyState, InlineError, useToast } from "@/components/ui";

/**
 * 跨页复用的错误 / 无权限态视图（ORB-002）。
 *
 * docs/02 §7：
 *  - 网络失败 → 局部错误、重试、保留草稿（不整页替换，不清空用户输入）。
 *  - 未登录/会话过期 → 跳登录并保留合法 returnTo（M0 样例以提示代替真实跳转）。
 *  - 无权限/不存在 → 统一不可访问页面，不泄露项目名称。
 */

/** 局部错误：驻留提示（非仅 Toast）+ 重试 + 保留草稿说明。 */
export function SampleError({
  message = "加载失败，无法获取数据。",
  draftNote = "你已填写的草稿已保留，重试不会清空当前输入。",
  className,
}: {
  message?: string;
  draftNote?: ReactNode;
  className?: string;
}) {
  const { toast } = useToast();
  return (
    <div className={className}>
      <InlineError className="mb-3">{message}</InlineError>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            toast({
              title: "样例模式：未连接真实后端",
              description: "重试在真实数据层（TanStack Query）接入后才会重新拉取。",
            })
          }
        >
          <RotateCw className="h-4 w-4" aria-hidden="true" />
          重试
        </Button>
        {draftNote ? (
          <p className="text-caption text-foreground-muted">{draftNote}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 真实错误面板（F24 修复）：单一明确的重试动作，重试由调用方传入真实重新拉取回调，
 * 不再弹出样例 toast（样例页请继续用上方 SampleError）。
 * docs/02 §7：网络失败 → 局部错误、可重试、保留草稿（不清空用户输入/已选文件）。
 */
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

/**
 * 统一不可访问页面：不泄露项目名/资源是否存在（无权限与不存在同一外观）。
 * 未登录/会话过期场景可传 `reason="session"` 显示登录跳转提示。
 */
export function NoAccess({
  reason = "forbidden",
  onPrimary,
}: {
  reason?: "forbidden" | "session";
  onPrimary?: () => void;
}) {
  const session = reason === "session";
  return (
    <EmptyState
      className="mx-auto mt-8 max-w-lg"
      icon={<Lock className="h-6 w-6" />}
      title={session ? "登录状态已失效" : "无法访问此内容"}
      description={
        session
          ? "你的会话可能已过期。重新登录后，我们会把你带回原来的页面。"
          : "它可能不存在，或你没有访问权限。为避免泄露信息，我们不会区分这两种情况。"
      }
      action={
        <Button
          variant={session ? "primary" : "secondary"}
          onClick={
            onPrimary ??
            (() => {
              /* M0 样例：真实跳转在 M1 认证接入后实现 */
            })
          }
        >
          {session ? "前往登录" : "返回工作台"}
        </Button>
      }
    />
  );
}
