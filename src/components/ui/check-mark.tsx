import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

/**
 * 对勾。`animate` 为真时从左到右画出来（完成一件事的那一下）；平时直接显示。
 * 路径按书写顺序排列：先短的一笔，再长的一笔。
 */
export function CheckMark({
  animate = false,
  strokeWidth = 3,
  className,
}: {
  animate?: boolean;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <path
        d="M4 12.5l5 5L20 6.5"
        pathLength={1}
        className={animate ? "animate-check-draw [stroke-dasharray:1]" : undefined}
        style={animate ? ({ "--check-length": 1 } as CSSProperties) : undefined}
      />
    </svg>
  );
}
