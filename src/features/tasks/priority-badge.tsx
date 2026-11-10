import { CalendarDays } from "lucide-react";
import type { TaskPriority } from "@/contracts";
import { cn } from "@/lib/cn";
import { PRIORITY_LABEL, type DueMeta } from "./task-meta";

/**
 * 优先级和截止日的小标记。一张卡片上最多一个重点色：只有高优先级和逾期用红色，
 * 并且都有图形或文字，不单靠颜色。
 */

const LEVEL: Record<TaskPriority, number> = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
const BAR_HEIGHT = ["h-[5px]", "h-2", "h-[11px]"];

/** 三格信号条：格数就是优先级。无优先级时不渲染。 */
export function PriorityMark({
  priority,
  withLabel = false,
  className,
}: {
  priority: TaskPriority;
  /** 在图形后显示「高 / 中 / 低」。 */
  withLabel?: boolean;
  className?: string;
}) {
  const level = LEVEL[priority];
  if (level === 0) {
    return withLabel ? <span className={cn("text-caption text-foreground-muted", className)}>无</span> : null;
  }
  const high = priority === "HIGH";
  return (
    <span
      title={`优先级：${PRIORITY_LABEL[priority]}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-caption",
        high ? "font-medium text-danger" : "text-foreground-secondary",
        className,
      )}
    >
      <span aria-hidden="true" className="flex h-[11px] items-end gap-[2px]">
        {BAR_HEIGHT.map((height, index) => (
          <span
            key={height}
            className={cn("w-[3px] rounded-[1px]", height, index < level ? "bg-current" : "bg-line")}
          />
        ))}
      </span>
      {withLabel ? <span aria-hidden="true">{PRIORITY_LABEL[priority]}</span> : null}
      <span className="sr-only">优先级：{PRIORITY_LABEL[priority]}</span>
    </span>
  );
}

const dueToneClass: Record<DueMeta["tone"], string> = {
  overdue: "font-medium text-danger",
  today: "font-medium text-warning",
  soon: "text-foreground-secondary",
  later: "text-foreground-muted",
  none: "text-foreground-muted",
};

/** 截止日：日历图标加日期，逾期和今天用重点色，完整说明在 title 里。 */
export function DueBadge({ meta, className }: { meta: DueMeta; className?: string }) {
  return (
    <span
      title={meta.label}
      className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-caption", dueToneClass[meta.tone], className)}
    >
      <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span aria-hidden="true">
        {meta.short}
        {meta.overdue ? " 逾期" : ""}
      </span>
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}
