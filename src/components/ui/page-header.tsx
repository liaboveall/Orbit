import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** 页面大标题：一行上下文、一个 h1、一行说明，操作放在右侧。全站页头都用它。 */
export function PageHeader({
  eyebrow,
  title,
  description,
  leading,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** 标题左侧的图形，例如项目图标。 */
  leading?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="flex min-w-0 flex-1 basis-72 items-center gap-4">
        {leading}
        <div className="min-w-0">
          {eyebrow ? (
            <div className="mb-0.5 truncate text-label font-medium text-foreground-muted">{eyebrow}</div>
          ) : null}
          <h1 className="text-page font-semibold tracking-[-0.012em] text-foreground [overflow-wrap:anywhere]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-label leading-relaxed text-foreground-secondary">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
