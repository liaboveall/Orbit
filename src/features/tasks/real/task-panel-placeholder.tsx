"use client";

import { CalendarDays, CircleDashed, Link2, ListChecks, MessageSquare, MoreHorizontal, SignalHigh, UserRound, X } from "lucide-react";
import type { TaskSummaryDTO } from "@/contracts";
import { Button, IconButton, NativeSelect, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { PRIORITY_LABEL, STATUS_LABEL } from "../task-meta";
import { detailGroup, detailTitle, dueDateControl, PropertyRow, propertyControl } from "./task-detail-parts";

/**
 * 任务面板「正在打开」时的内容。
 *
 * 点击任务卡后面板立刻出现，先用卡片上已有的信息（编号、标题、状态、优先级、
 * 负责人、截止日）排出与编辑器相同的版面，描述、子任务和评论用骨架占位。
 * 服务端数据到达后原地换成编辑器，版面不跳。占位期间属性不可操作（inert），
 * 关闭按钮照常可用。
 */
export function TaskPanelPlaceholder({
  summary,
  onClose,
}: {
  /** 卡片上的任务摘要；从地址直接进入、还没有摘要时为 null。 */
  summary: TaskSummaryDTO | null;
  onClose: () => void;
}) {
  return (
    <section aria-busy="true">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3 sm:px-5">
        <span className="text-label font-medium tabular-nums text-foreground-muted">
          {summary ? summary.identifier : <Skeleton className="h-4 w-20" />}
        </span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled>
            <Link2 className="h-4 w-4" aria-hidden="true" />
            复制链接
          </Button>
          <IconButton label="更多操作" size="sm" disabled>
            <MoreHorizontal className="h-4 w-4" />
          </IconButton>
          <IconButton label="关闭详情" size="sm" className="bg-surface-sunken" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
      </header>

      <div className="space-y-5 px-4 pb-8 pt-1 sm:px-5">
        <p role="status" className="sr-only">
          正在加载任务详情
        </p>
        <h2 className={detailTitle}>
          {summary ? (
            <span className="-mx-1.5 block px-1.5 py-0.5 [overflow-wrap:anywhere]">{summary.title}</span>
          ) : (
            <Skeleton className="my-1 h-7 w-3/5" />
          )}
        </h2>

        {summary ? (
          <div inert className={cn(detailGroup, "divide-y divide-line")}>
            <PropertyRow label="状态" icon={CircleDashed}>
              <NativeSelect aria-label="状态" className={propertyControl} value={summary.status} onChange={() => undefined}>
                <option value={summary.status}>{STATUS_LABEL[summary.status]}</option>
              </NativeSelect>
            </PropertyRow>
            <PropertyRow label="优先级" icon={SignalHigh}>
              <NativeSelect aria-label="优先级" className={propertyControl} value={summary.priority} onChange={() => undefined}>
                <option value={summary.priority}>{PRIORITY_LABEL[summary.priority]}</option>
              </NativeSelect>
            </PropertyRow>
            <PropertyRow label="负责人" icon={UserRound}>
              <NativeSelect
                aria-label="负责人"
                wrapperClassName="max-w-[60%]"
                className={propertyControl}
                value={summary.assignee?.id ?? ""}
                onChange={() => undefined}
              >
                <option value={summary.assignee?.id ?? ""}>{summary.assignee?.name ?? "未分配"}</option>
              </NativeSelect>
            </PropertyRow>
            <PropertyRow label="截止日" icon={CalendarDays}>
              <input aria-label="截止日" type="date" readOnly className={dueDateControl} value={summary.dueDate ?? ""} />
            </PropertyRow>
          </div>
        ) : (
          <Skeleton className="h-[164px] rounded-tile" />
        )}

        <div className="space-y-2">
          <h2 className="px-1 text-label font-semibold text-foreground">描述</h2>
          <Skeleton className="h-20 rounded-tile" />
        </div>

        <div className="space-y-3">
          <h2 className="flex items-center gap-2 px-1 text-label font-semibold text-foreground">
            <ListChecks className="h-4 w-4 text-foreground-muted" aria-hidden="true" />
            子任务
          </h2>
          <div className="space-y-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="flex items-center gap-2 px-1 text-label font-semibold text-foreground">
            <MessageSquare className="h-4 w-4 text-foreground-muted" aria-hidden="true" />
            评论
          </h2>
          <Skeleton className="h-14" />
        </div>
      </div>
    </section>
  );
}
