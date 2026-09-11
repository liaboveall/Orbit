import { Calendar, Flag } from "lucide-react";
import type { TaskPriority } from "@/contracts";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { PRIORITY_LABEL, type DueMeta } from "./task-meta";

/**
 * 业务展示组件（ORB-002）：PriorityBadge / DueBadge。
 *
 * docs/02 §5：高优先级用「图标 + 文案」标识，逾期用「图标 + 文案」，
 * 不把所有卡片染红——因此仅 HIGH/逾期使用强调色，其余保持中性。
 */

const priorityTone: Record<TaskPriority, BadgeTone> = {
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "neutral",
  NONE: "neutral",
};

export function PriorityBadge({
  priority,
  className,
}: {
  priority: TaskPriority;
  className?: string;
}) {
  return (
    <Badge
      tone={priorityTone[priority]}
      icon={priority === "HIGH" ? <Flag className="h-3 w-3" /> : undefined}
      className={className}
    >
      <span aria-hidden="true">{PRIORITY_LABEL[priority]}</span>
      <span className="sr-only">优先级：{PRIORITY_LABEL[priority]}</span>
    </Badge>
  );
}

const dueToneClass: Record<DueMeta["tone"], string> = {
  overdue: "text-danger",
  today: "text-warning",
  soon: "text-foreground-secondary",
  later: "text-foreground-muted",
  none: "text-foreground-muted",
};

/** 截止日：日历图标 + MM/DD，逾期/今天用强调色并附完整说明（title/aria-label）。 */
export function DueBadge({
  meta,
  className,
}: {
  meta: DueMeta;
  className?: string;
}) {
  return (
    <span
      title={meta.label}
      aria-label={meta.label}
      className={cn(
        "inline-flex items-center gap-1 text-caption",
        dueToneClass[meta.tone],
        className,
      )}
    >
      <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{meta.short}</span>
      {meta.overdue ? (
        <span className="font-medium">
          <Flag className="mr-0.5 inline h-3 w-3" aria-hidden="true" />
          逾期
        </span>
      ) : null}
    </span>
  );
}
