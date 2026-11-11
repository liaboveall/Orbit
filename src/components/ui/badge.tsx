import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Badge（ORB-002）：优先级、状态、计数等小标签。
 *
 * docs/02 §5：任务卡「最多一个重点色状态」，高优先级/逾期用图标+文案而非把整卡染红。
 * tone 决定语义配色（配 success/warning/danger soft 底 + 深色文字，均过 AA）。
 */

export type BadgeTone =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger";

const toneClass: Record<BadgeTone, string> = {
  neutral: "bg-surface-sunken text-foreground-secondary",
  brand: "bg-brand-soft text-brand-ink",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export type BadgeProps = Omit<ComponentProps<"span">, "children"> & {
  tone?: BadgeTone;
  icon?: ReactNode;
  children?: ReactNode;
};

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium whitespace-nowrap",
        toneClass[tone],
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
