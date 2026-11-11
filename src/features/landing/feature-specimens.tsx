import { AlarmClock, CalendarDays, Check, Paperclip, Sun, type LucideIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { DEMO_DATE } from "@/features/demo/board-data";
import { DueBadge, PriorityMark } from "@/features/tasks/priority-badge";
import { StatusGlyph } from "@/features/tasks/status-glyph";
import { getDueMeta } from "@/features/tasks/task-meta";
import { cn } from "@/lib/cn";
import type { TaskPriority, TaskStatus } from "@/contracts";

/**
 * 介绍页三项功能的配图：用应用里的真实零件（状态图形、优先级、截止日、头像）
 * 拼出的小样，不是截图。全部是装饰，文字说明在卡片正文里。
 */

const sheet = "rounded-tile bg-surface shadow-[inset_0_0_0_0.5px_var(--color-line)]";

const ROWS: { title: string; status: TaskStatus; priority: TaskPriority; due: string | null }[] = [
  { title: "重构签到二维码", status: "IN_PROGRESS", priority: "HIGH", due: "2026-09-07" },
  { title: "设计排班表", status: "TODO", priority: "MEDIUM", due: "2026-09-12" },
  { title: "明确数据结构", status: "DONE", priority: "LOW", due: null },
];

/** 看清进度：三行任务，状态、优先级和截止日各用一种图形。 */
export function ProgressSpecimen() {
  return (
    <div aria-hidden="true" className={cn(sheet, "divide-y divide-line")}>
      {ROWS.map((row) => (
        <div key={row.title} className="flex h-12 items-center gap-2.5 px-3.5">
          <StatusGlyph status={row.status} />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-label font-medium",
              row.status === "DONE" ? "text-foreground-muted line-through" : "text-foreground",
            )}
          >
            {row.title}
          </span>
          <PriorityMark priority={row.priority} />
          {row.due ? <DueBadge meta={getDueMeta(row.due, DEMO_DATE, row.status)} /> : null}
        </div>
      ))}
    </div>
  );
}

const COMMENTS = [
  { who: "陈墨", text: "取消报名已经联调通过。" },
  { who: "林夏", text: "重复报名的提示放在描述里了。" },
];

/** 围绕任务协作：两条评论，下面是子任务进度和一个附件。 */
export function DiscussionSpecimen() {
  return (
    <div aria-hidden="true" className={cn(sheet, "space-y-3 p-3.5")}>
      {COMMENTS.map((comment) => (
        <div key={comment.who} className="flex items-start gap-2.5">
          <Avatar name={comment.who} size="sm" className="mt-0.5" />
          <p className="min-w-0 flex-1 text-label leading-snug">
            <span className="font-medium text-foreground">{comment.who}</span>
            <span className="block truncate text-foreground-secondary">{comment.text}</span>
          </p>
        </div>
      ))}
      <div className="flex items-center gap-3 border-t border-line pt-3 text-caption text-foreground-muted">
        <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-success text-[var(--color-surface-solid)]">
            <Check className="h-2.5 w-2.5" strokeWidth={3.4} />
          </span>
          子任务 3/5
        </span>
        <span className="inline-flex min-w-0 items-center gap-1">
          <Paperclip className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">验收说明.pdf</span>
        </span>
      </div>
    </div>
  );
}

const TILES: { label: string; count: number; icon: LucideIcon; fill: string }[] = [
  { label: "逾期", count: 2, icon: AlarmClock, fill: "bg-danger-fill" },
  { label: "今天到期", count: 1, icon: Sun, fill: "bg-project-orange" },
  { label: "未来 7 天", count: 4, icon: CalendarDays, fill: "bg-project-purple" },
];

/** 专注下一步：工作台的三格分类磁贴。 */
export function FocusSpecimen() {
  return (
    <div aria-hidden="true" className="grid grid-cols-3 gap-2">
      {TILES.map(({ label, count, icon: Icon, fill }) => (
        <div key={label} className={cn(sheet, "flex flex-col gap-3 p-3")}>
          <span className="flex items-start justify-between">
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]",
                fill,
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={2.2} />
            </span>
            <span className="text-[24px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
              {count}
            </span>
          </span>
          <span className="truncate text-caption font-medium text-foreground-secondary">{label}</span>
        </div>
      ))}
    </div>
  );
}
