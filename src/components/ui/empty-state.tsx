import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * EmptyState（ORB-002）：真正无数据 / 筛选无结果时使用。
 *
 * docs/02 §5、§7：空态要「解释价值并提供下一步」——标题说明现状，
 * 描述给出意义，action 提供明确的下一步操作（如「创建项目」）。
 * 使用简单线形图标（icon 由调用方传入 lucide 节点），不做庆祝动画。
 */

export type EmptyStateProps = Omit<ComponentProps<"div">, "title"> & {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-card border border-line",
        "bg-surface px-6 py-16 text-center",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken text-foreground-muted"
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <div className="max-w-prose space-y-2">
        <p className="text-section font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="text-label text-foreground-secondary">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}
