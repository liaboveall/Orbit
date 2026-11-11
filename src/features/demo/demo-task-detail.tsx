import Link from "next/link";
import { CalendarDays, CircleDashed, ListTodo, MessageSquare, SignalHigh, UserRound, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { TaskSummaryDTO } from "@/contracts";
import { Avatar } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { DueBadge, PriorityMark } from "@/features/tasks/priority-badge";
import { StatusGlyph } from "@/features/tasks/status-glyph";
import { getDueMeta, STATUS_LABEL } from "@/features/tasks/task-meta";
import { cn } from "@/lib/cn";
import { DEMO_DATE } from "./board-data";
import { DEMO_SUBTASK_TITLES } from "./fixtures";

/**
 * 演示任务的详情：排版与真实任务面板一致（属性组、描述、子任务、评论），内容全部只读。
 * 放在 Drawer 里使用。
 */

const group = "rounded-tile bg-surface shadow-[inset_0_0_0_0.5px_var(--color-line)]";

function Property({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-3.5 text-label md:min-h-10">
      <dt className="flex items-center gap-2.5 text-foreground-secondary">
        <Icon className="h-4 w-4 text-foreground-muted" aria-hidden="true" />
        {label}
      </dt>
      <dd className="flex min-w-0 items-center gap-2 text-foreground">{children}</dd>
    </div>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center gap-2 px-1 text-label font-semibold text-foreground">
      <Icon className="h-4 w-4 text-foreground-muted" aria-hidden="true" />
      {children}
    </h3>
  );
}

export function DemoTaskDetail({ task }: { task: TaskSummaryDTO }) {
  const due = getDueMeta(task.dueDate, DEMO_DATE, task.status);
  const subtasks = DEMO_SUBTASK_TITLES.slice(0, task.subtaskTotal);
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-5 sm:p-6">
      <header className="pr-10">
        <p className="text-label font-medium tabular-nums text-foreground-muted">{task.identifier}</p>
        <DrawerTitle className="mt-2 text-section font-semibold tracking-[-0.012em] [overflow-wrap:anywhere]">
          {task.title}
        </DrawerTitle>
        <DrawerDescription>合成的任务详情，只读。</DrawerDescription>
      </header>

      <dl className={cn(group, "divide-y divide-line")}>
        <Property icon={CircleDashed} label="状态">
          <StatusGlyph status={task.status} className="h-4 w-4" />
          {STATUS_LABEL[task.status]}
        </Property>
        <Property icon={SignalHigh} label="优先级">
          <PriorityMark priority={task.priority} withLabel className="text-label" />
        </Property>
        <Property icon={UserRound} label="负责人">
          {task.assignee ? (
            <>
              <Avatar name={task.assignee.name} size="sm" />
              <span className="truncate">{task.assignee.name}</span>
            </>
          ) : (
            <span className="text-foreground-muted">未分配</span>
          )}
        </Property>
        <Property icon={CalendarDays} label="截止日">
          {task.dueDate ? <DueBadge meta={due} className="text-label" /> : <span className="text-foreground-muted">无截止日</span>}
        </Property>
      </dl>

      <section>
        <h3 className="mb-2 px-1 text-label font-semibold text-foreground">描述</h3>
        <div className={cn(group, "space-y-2 px-3.5 py-3 text-label leading-relaxed text-foreground-secondary")}>
          <p>这是一条合成的演示任务，用来展示任务详情的样子。</p>
          <p>真实项目里，描述支持 Markdown；标题和描述的草稿会保存在本机，编辑冲突时不会丢失。</p>
        </div>
      </section>

      {subtasks.length > 0 ? (
        <section>
          <SectionTitle icon={ListTodo}>
            子任务（{task.subtaskCompleted}/{task.subtaskTotal}）
          </SectionTitle>
          <ul className={cn(group, "divide-y divide-line")}>
            {subtasks.map((title, index) => {
              const done = index < task.subtaskCompleted;
              return (
                <li key={title} className="flex min-h-11 items-center gap-2.5 px-3.5 text-label md:min-h-10">
                  <StatusGlyph status={done ? "DONE" : "TODO"} />
                  <span className={done ? "text-foreground-muted line-through" : "text-foreground"}>{title}</span>
                  <span className="sr-only">{done ? "，已完成" : "，未完成"}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section>
        <SectionTitle icon={MessageSquare}>评论</SectionTitle>
        <ul className={cn(group, "space-y-3.5 px-3.5 py-3.5")}>
          {[
            { who: "陈墨", text: "已核对交互，等待验收。" },
            { who: "林夏", text: "验收清单放在附件里了，周五前过一遍。" },
          ].map((comment) => (
            <li key={comment.who} className="flex items-start gap-2.5">
              <Avatar name={comment.who} size="sm" className="mt-0.5" />
              <p className="min-w-0 flex-1 text-label leading-relaxed">
                <span className="font-medium text-foreground">{comment.who}</span>
                <span className="block text-foreground-secondary">{comment.text}</span>
              </p>
            </li>
          ))}
        </ul>
      </section>

      <div className="rounded-tile bg-brand-soft px-4 py-3.5">
        <p className="text-label leading-relaxed text-brand-ink">
          演示为只读。注册后可以在自己的项目里编辑任务、发表评论和上传附件。
        </p>
        <Link href="/auth/register" className={buttonVariants({ size: "sm", className: "mt-3" })}>
          免费创建项目
        </Link>
      </div>
    </div>
  );
}
