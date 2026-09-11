import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Skeleton（ORB-002）：加载占位。
 *
 * docs/02 §4、§7：加载时外壳尺寸稳定、避免整屏 spinner——用与真实布局同形的骨架。
 * pulse 动画在 prefers-reduced-motion 下由 tokens.css 全局规则自动降级为近乎静止。
 */

export type SkeletonProps = ComponentProps<"div">;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-control bg-surface-sunken",
        className,
      )}
      {...props}
    />
  );
}

/**
 * 带屏幕阅读器语义的加载区块：视觉是骨架，同时用 role="status" + 文本
 * 向辅助技术宣告「加载中」，避免纯装饰骨架对读屏不可见。
 */
export function SkeletonBlock({
  label = "加载中",
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" className={cn("relative", className)}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
