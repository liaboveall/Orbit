"use client";

import { Archive, Inbox, Plus, SearchX } from "lucide-react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { MemberDTO, ProjectDTO, TaskSummaryDTO, TaskListQueryDTO } from "@/contracts";
import { Avatar, Button, buttonVariants, EmptyState, InlineError, Spinner } from "@/components/ui";
import { DueBadge, PriorityMark } from "@/features/tasks/priority-badge";
import { getDueMeta } from "@/features/tasks/task-meta";
import { cn } from "@/lib/cn";
import { loginPathWithReturnTo } from "@/lib/return-to";
import { usePagedTasks } from "../use-paged-tasks";
import { TaskCreateDialog } from "./task-create-form";
import { TaskFilters } from "./task-filters";
import { TaskDeleteButton } from "./task-delete-button";
import { useTaskMutation } from "./use-task-mutation";
import { TaskStatusSelect } from "./task-status-select";

/**
 * 项目任务列表。
 *
 * 首屏数据由服务端页面读取后经 props 传入；行内切换状态、创建、删除都走 API，
 * 成功后 `router.refresh()` 让服务端重读。props 是唯一的数据真源，这里不把任务镜像到
 * state（镜像会和刷新后的 props 脱节，旧 version 会让同页第二次写入报 409）。
 *
 * 入口按已知角色收敛，服务端仍是权威：删除只给项目所有者和任务创建者，
 * 归档项目隐藏新建入口。
 */

/** 与 page.tsx 首屏一致的页大小。 */
const PAGE_SIZE = 50;

export type TaskListClientProps = {
  project: ProjectDTO;
  members: MemberDTO[];
  initialTasks: TaskSummaryDTO[];
  nextCursor: string | null;
  /** 用户时区下的今天，用于判断逾期和临近。 */
  today: string;
  userId: string;
  query?: TaskListQueryDTO;
};

export function TaskListClient({
  project,
  members,
  initialTasks,
  nextCursor: initialCursor,
  today,
  userId,
  query = {},
}: TaskListClientProps) {
  const router = useRouter();
  const tasksPath = `/app/projects/${project.id}/tasks`;

  const [creating, setCreating] = useState(false);
  const { tasks, cursor, busy: loadingMore, error: pageError, more } = usePagedTasks(
    `/projects/${project.id}/tasks`, `${userId}:${today}`, { ...query, limit: PAGE_SIZE }, initialTasks, initialCursor,
  );
  const goToLogin = () => window.location.assign(loginPathWithReturnTo(tasksPath));
  const archived = project.archivedAt !== null;
  const isOwner = project.role === "OWNER";
  // 筛选无结果和项目里还没有任务是两种空状态。
  const hasActiveFilters = Boolean(
    query.q || query.status || query.priority || query.assigneeId || query.unassigned || query.overdue,
  );
  const rowProps = (task: TaskSummaryDTO) => ({
    task,
    today,
    canDelete: !archived && (isOwner || task.creator.id === userId),
    archived,
    onUnauthorized: goToLogin,
  });

  return (
    <div className="w-full outline-none" data-project-content tabIndex={-1} data-task-editing={creating || undefined}>
      <TaskFilters
        members={members}
        action={
          archived ? null : (
            <Button onClick={() => setCreating(true)} className="max-sm:h-11 max-sm:w-11 max-sm:px-0">
              <Plus className="h-4 w-4 max-sm:h-5 max-sm:w-5" aria-hidden="true" />
              <span className="max-sm:sr-only">新建任务</span>
            </Button>
          )
        }
      />

      {archived ? null : (
        <TaskCreateDialog
          open={creating}
          onOpenChange={setCreating}
          projectId={project.id}
          onCreated={() => {
            // 新任务由刷新后的服务端 props 提供。
            setCreating(false);
            router.refresh();
          }}
          onUnauthorized={goToLogin}
        />
      )}

      <InlineError className="mb-4">{pageError}</InlineError>

      {tasks.length === 0 ? (
        archived ? (
          <EmptyState
            icon={<Archive className="h-6 w-6" />}
            title="项目已归档"
            description="归档项目处于只读状态，无法创建新任务。恢复项目后可继续。"
          />
        ) : hasActiveFilters ? (
          <EmptyState
            icon={<SearchX className="h-6 w-6" />}
            title="没有符合筛选的任务"
            description="换个关键词或清除筛选后，可查看项目的全部任务。"
            action={
              <Link href={tasksPath} className={buttonVariants({ variant: "secondary" })}>
                清除筛选
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<Inbox className="h-6 w-6" />}
            title="还没有任务"
            description="创建第一个任务，就能在列表中切换状态、设定优先级与截止日。"
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                新建任务
              </Button>
            }
          />
        )
      ) : (
        <>
          {/* 平板和桌面：表格，列头便于扫读。固定列宽，长标题在自己的列里截断，不挤走其它列。 */}
          <div className="surface-card relative hidden overflow-x-auto rounded-card md:block">
            <table className="w-full min-w-[600px] table-fixed border-collapse text-left">
              <caption className="sr-only">项目任务列表</caption>
              <thead>
                <tr className="border-b border-line text-caption text-foreground-muted">
                  <th scope="col" className="py-2.5 pl-5 pr-3 font-medium">任务</th>
                  <th scope="col" className="w-36 px-3 py-2.5 font-medium">状态</th>
                  <th scope="col" className="w-24 px-3 py-2.5 font-medium">优先级</th>
                  <th scope="col" className="hidden w-36 px-3 py-2.5 font-medium lg:table-cell">负责人</th>
                  <th scope="col" className="w-32 px-3 py-2.5 font-medium">截止日</th>
                  <th scope="col" className="w-14 py-2.5 pl-3 pr-4 font-medium">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tasks.map((task) => (
                  <TaskRow key={task.id} {...rowProps(task)} />
                ))}
              </tbody>
            </table>
          </div>

          {/* 手机：同样的信息和操作排成卡片，不横向滚动 */}
          <ul role="list" className="space-y-2 md:hidden" aria-label="项目任务列表">
            {tasks.map((task) => (
              <TaskCard key={task.id} {...rowProps(task)} />
            ))}
          </ul>
        </>
      )}

      {cursor !== null ? (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" disabled={loadingMore} aria-busy={loadingMore || undefined} onClick={() => void more()}>
            {loadingMore ? <Spinner /> : null}
            <span>{loadingMore ? "正在加载…" : "加载更多"}</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

type RowProps = {
  task: TaskSummaryDTO;
  today: string;
  canDelete: boolean;
  archived: boolean;
  onUnauthorized: () => void;
};

/** 打开任务详情面板的地址：在当前筛选上加 task 参数。 */
function useTaskHref(taskId: string): string {
  const path = usePathname();
  const target = new URLSearchParams(useSearchParams().toString());
  target.set("task", taskId);
  return `${path}?${target}`;
}

function Assignee({ task }: { task: TaskSummaryDTO }) {
  if (!task.assignee) return <span className="text-caption text-foreground-muted">未分配</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={task.assignee.name} size="sm" />
      <span className="min-w-0 truncate text-caption text-foreground-secondary">{task.assignee.name}</span>
    </span>
  );
}

/** 完成的任务用删除线表达，不压低整行的对比度。 */
const titleClass = (done: boolean) =>
  cn("min-w-0 text-label font-medium text-foreground", done && "line-through decoration-foreground-muted");

function TaskRow({ task, today, canDelete, archived, onUnauthorized }: RowProps) {
  const href = useTaskHref(task.id);
  const mutation = useTaskMutation();
  return (
    <tr className="group/row transition-colors duration-150 ease-standard hover:bg-surface-sunken">
      <th scope="row" className="py-3 pl-5 pr-3 font-normal">
        <span className="flex min-w-0 items-baseline gap-2.5">
          <span className="shrink-0 text-caption tabular-nums text-foreground-muted">{task.identifier}</span>
          <Link
            href={href}
            scroll={false}
            data-task-link={task.id}
            className={cn(titleClass(task.status === "DONE"), "truncate")}
            title={task.title}
          >
            {task.title}
          </Link>
        </span>
      </th>
      <td className="px-3 py-2">
        <TaskStatusSelect mutation={mutation} task={task} disabled={archived} onUnauthorized={onUnauthorized} />
      </td>
      <td className="px-3 py-2">
        <PriorityMark priority={task.priority} withLabel />
      </td>
      <td className="hidden px-3 py-2 lg:table-cell">
        <Assignee task={task} />
      </td>
      <td className="px-3 py-2">
        <DueBadge meta={getDueMeta(task.dueDate, today, task.status)} />
      </td>
      <td className="py-2 pl-3 pr-4">
        {canDelete ? (
          <span className="block opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100">
            <TaskDeleteButton mutation={mutation} task={task} onUnauthorized={onUnauthorized} />
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function TaskCard({ task, today, canDelete, archived, onUnauthorized }: RowProps) {
  const href = useTaskHref(task.id);
  const mutation = useTaskMutation();
  return (
    <li className="surface-card relative rounded-tile py-2 pl-3.5 pr-2">
      <span className={cn("flex min-w-0 items-baseline gap-2 pt-1.5", canDelete ? "pr-10" : "pr-1.5")}>
        <span className="shrink-0 text-caption tabular-nums text-foreground-muted">{task.identifier}</span>
        {/* 与表格行的 data-task-link 分开，关闭面板后焦点回到当前可见的那一个。 */}
        <Link
          href={href}
          scroll={false}
          data-task-card-link={task.id}
          className={cn(titleClass(task.status === "DONE"), "break-words")}
          title={task.title}
        >
          {task.title}
        </Link>
      </span>
      {/* 删除按钮浮在右上角，不把标题行撑高。 */}
      {canDelete ? (
        <span className="absolute right-1 top-0.5">
          <TaskDeleteButton mutation={mutation} task={task} onUnauthorized={onUnauthorized} />
        </span>
      ) : null}
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 pr-1.5">
        <TaskStatusSelect mutation={mutation} task={task} disabled={archived} onUnauthorized={onUnauthorized} />
        <PriorityMark priority={task.priority} />
        <DueBadge meta={getDueMeta(task.dueDate, today, task.status)} />
        <Assignee task={task} />
      </div>
    </li>
  );
}
