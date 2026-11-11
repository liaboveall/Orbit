import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * 页面标题。顶层页面用 PageHeader（h1）；项目内的分区用 SectionHeader（h2），
 * 因为项目名已经是那一页的 h1。两者排版一致，只有字号和层级不同。
 */

type HeaderProps = {
  /** 标题上方的一行上下文，例如日期。 */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** 右侧的操作。 */
  actions?: ReactNode;
  className?: string;
};

function Header({ level, eyebrow, title, description, actions, className }: HeaderProps & { level: 1 | 2 }) {
  const Title = level === 1 ? "h1" : "h2";
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", level === 1 ? "mb-6" : "mb-4", className)}>
      <div className="min-w-0 flex-1 basis-64">
        {eyebrow ? <p className="mb-1 truncate text-label font-medium text-foreground-muted">{eyebrow}</p> : null}
        <Title
          className={cn(
            "font-semibold text-foreground [overflow-wrap:anywhere]",
            level === 1 ? "text-page tracking-[-0.015em]" : "text-section tracking-[-0.012em]",
          )}
        >
          {title}
        </Title>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-label leading-relaxed text-foreground-secondary">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function PageHeader(props: HeaderProps) {
  return <Header level={1} {...props} />;
}

export function SectionHeader(props: HeaderProps) {
  return <Header level={2} {...props} />;
}
