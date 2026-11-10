"use client";

import { Check, MoreHorizontal } from "lucide-react";
import type { TaskStatus, TaskSummaryDTO } from "@/contracts";
import { IconButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaskCardFace } from "@/features/board/task-card-face";
import { StatusGlyph } from "@/features/tasks/status-glyph";
import { STATUS_LABEL } from "@/features/tasks/task-meta";
import { DEMO_DATE } from "./board-data";

export type DemoTaskCardProps = {
  task: TaskSummaryDTO;
  onOpen: () => void;
  onChangeStatus: (status: TaskStatus) => void;
};

/** 演示任务卡：与真实看板共用排版，所有写操作都只给出提示。 */
export function DemoTaskCard({ task, onOpen, onChangeStatus }: DemoTaskCardProps) {
  return (
    <article className="surface-card lift group relative rounded-tile p-3">
      <TaskCardFace
        task={task}
        today={DEMO_DATE}
        status={<StatusGlyph status={task.status} className="mt-px" />}
        title={
          <button
            type="button"
            onClick={onOpen}
            className="line-clamp-2 block w-full rounded-[6px] text-left text-label font-medium text-foreground outline-none [overflow-wrap:anywhere] hover:text-brand-ink"
          >
            {task.title}
          </button>
        }
        corner={
          <div className="-mr-1 -mt-1 transition-opacity duration-150 max-sm:-m-2.5 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={`更多操作：${task.title}`} size="sm" className="sm:h-6 sm:w-6">
                  <MoreHorizontal className="h-4 w-4" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onOpen}>打开详情</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>移动到</DropdownMenuLabel>
                {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
                  <DropdownMenuItem key={s} disabled={s === task.status} onSelect={() => onChangeStatus(s)}>
                    {s === task.status ? <Check className="h-4 w-4" /> : <span className="h-4 w-4" aria-hidden="true" />}
                    {STATUS_LABEL[s]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
    </article>
  );
}
