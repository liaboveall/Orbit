"use client";

import { Check, MoreHorizontal } from "lucide-react";
import { TaskResourceCounts } from "@/features/board/task-resource-counts";
import type { TaskStatus, TaskSummaryDTO } from "@/contracts";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/button";
import { DueBadge, PriorityBadge } from "@/features/tasks/priority-badge";
import { getDueMeta, STATUS_LABEL } from "@/features/tasks/task-meta";
import { DEMO_DATE } from "./board-data";

export type DemoTaskCardProps = {
  task: TaskSummaryDTO;
  onOpen: () => void;
  onChangeStatus: (status: TaskStatus) => void;
};

export function DemoTaskCard({
  task,
  onOpen,
  onChangeStatus,
}: DemoTaskCardProps) {
  const due = getDueMeta(task.dueDate, DEMO_DATE, task.status);

  return (
    <article
      className={cn(
        "group relative rounded-card border bg-surface p-3",
        "transition-[border-color,box-shadow] duration-150 ease-standard",
        "border-line hover:border-line-strong",
      )}
    >
      {/* 第一行：编号 + 优先级 +（更多菜单） */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-caption text-foreground-muted">
          {task.identifier}
        </span>
        <PriorityBadge priority={task.priority} />
        <div
          className={cn(
            "ml-auto transition-opacity duration-150 ease-standard",
            // 手机常显；桌面 hover 或键盘 focus-within 时显示
            "opacity-100 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100",
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`更多操作：${task.title}`} size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onOpen}>打开详情</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>移动到</DropdownMenuLabel>
              {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
                <DropdownMenuItem
                  key={s}
                  disabled={s === task.status}
                  onSelect={() => onChangeStatus(s)}
                >
                  {s === task.status ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <span className="h-4 w-4" aria-hidden="true" />
                  )}
                  {STATUS_LABEL[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 第二行：标题（两行截断，作为打开详情的可访问控件） */}
      <button
        type="button"
        onClick={onOpen}
        className="mt-1.5 block w-full rounded-control text-left text-label font-medium text-foreground outline-none [overflow-wrap:anywhere] hover:underline line-clamp-2"
      >
        {task.title}
      </button>

      {/* 第三行：子任务 / 评论 / 附件计数（图标 + 数字） */}
      <TaskResourceCounts task={task} />

      {/* 第四行：截止日 + 负责人 */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <DueBadge meta={due} />
        {task.assignee ? (
          <span className="flex items-center gap-1.5">
            <Avatar name={task.assignee.name} size="sm" />
            <span className="hidden text-caption text-foreground-secondary sm:inline">
              {task.assignee.name}
            </span>
          </span>
        ) : (
          <span className="text-caption text-foreground-muted">未分配</span>
        )}
      </div>
    </article>
  );
}
