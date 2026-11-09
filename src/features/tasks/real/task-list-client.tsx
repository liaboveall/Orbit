"use client";

import { confirmLeave } from "@/features/tasks/unsaved-changes";

import { Archive, Plus, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  type ProjectDTO,
  type TaskSummaryDTO,
  type TaskListQueryDTO,
} from "@/contracts";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineError } from "@/components/ui/inline-error";
import { Spinner } from "@/features/auth/auth-form";
import { DueBadge, PriorityBadge } from "@/features/tasks/priority-badge";
import { getDueMeta } from "@/features/tasks/task-meta";
import { cn } from "@/lib/cn";
import { loginPathWithReturnTo } from "@/lib/return-to";
import { usePagedTasks } from "../use-paged-tasks";
import { PROJECT_COLOR_DOT, projectColorAria } from "@/lib/project-color";
import { TaskCreateForm } from "./task-create-form";
import { TaskDeleteButton } from "./task-delete-button";
import { useTaskMutation } from "./use-task-mutation";
import { TaskStatusSelect } from "./task-status-select";

/**
 * 项目任务列表客户端（M2 Phase 6，`/app/projects/[id]/tasks`）。
 *
 *
 * 数据流：首屏由 Server Component 经领域服务读取后 props 传入；行内状态切换 /
 * 创建 / 删除都走契约层 API（PATCH /tasks/{id}、POST /projects/{id}/tasks、
 * DELETE /tasks/{id}），成功后 `router.refresh()` 让 Server Component 重读 ——
 * props 是唯一数据真源，客户端不镜像任务到 useState（镜像会与 refresh 后的新 props
 * 脱节，导致 task.version 陈旧 → 同页第二次写操作假 409 VERSION_CONFLICT）。
 *
 * 授权（服务端仍是权威，前端只按已知角色收敛入口）：
 *  - 状态切换：成员即可（归档项目服务端 409 PROJECT_ARCHIVED）；
 *  - 删除：仅项目 owner 或任务创建者（docs/05：其余成员 403），不满足则不渲染按钮；
 *  - 归档项目隐藏「新建任务」（服务端会拒绝写入）。
 */


/** 与 page.tsx 首屏一致的页大小。 */
const PAGE_SIZE = 50;

export type TaskListClientProps = {
  project: ProjectDTO;
  initialTasks: TaskSummaryDTO[];
  nextCursor: string | null;
  hasMore: boolean;
  /** UTC date-only（服务端渲染时刻），供截止日逾期/临近语义。 */
  today: string;
  userId: string;
  query?: TaskListQueryDTO;
};

export function TaskListClient({
  project,
  initialTasks,
  nextCursor: initialCursor,

  today,
  userId,
  query = {},
}: TaskListClientProps) {
  const router = useRouter();
  const tasksPath = `/app/projects/${project.id}/tasks`;

  const [creating, setCreating] = useState(false);
  const { tasks, cursor, busy: loadingMore, error: pageError, more: handleLoadMore } = usePagedTasks(
    `/projects/${project.id}/tasks`, `${userId}:${today}`, { ...query, limit: PAGE_SIZE }, initialTasks, initialCursor,
  );
  const [mutationError, setListError] = useState<string | null>(null);
  const listError = mutationError ?? pageError;
  const goToLogin = () => window.location.assign(loginPathWithReturnTo(tasksPath));
  const hasMore = cursor !== null;
  const archived = project.archivedAt !== null;
  const isOwner = project.role === "OWNER";
  // B9 修复：识别「有筛选条件」的空结果（与真空任务列表区分开）。
  const hasActiveFilters = Boolean(
    query.q || query.status || query.priority || query.assigneeId ||
      query.unassigned || query.overdue,
  );

  return (
    <div
      className="mx-auto w-full max-w-6xl"
      data-project-content
      tabIndex={-1}
      data-task-editing={creating || undefined}
    >
      {/* 页头：面包屑 + 项目标识 + 主操作 */}
      <header className="mb-6">
        <nav
          aria-label="面包屑"
          className="mb-2 flex items-center gap-1.5 text-caption"
        >
          <Link
            href="/app/projects"
            className="rounded-control text-foreground-muted outline-none transition-colors duration-150 ease-standard hover:text-brand"
          >
            全部项目
          </Link>
          <span aria-hidden="true" className="text-line-strong">
            /
          </span>
          <span className="min-w-0 truncate text-foreground-secondary">
            {project.name}
          </span>
        </nav>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={cn(
                "inline-block h-3.5 w-3.5 shrink-0 rounded-full",
                PROJECT_COLOR_DOT[project.color],
              )}
              aria-hidden="true"
            />
            <span className="sr-only">{projectColorAria(project.color)}</span>
            <div className="min-w-0">
              <h1 className="truncate text-page font-semibold tracking-tight text-foreground">
                {project.name}
              </h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-label text-foreground-secondary">
                <Badge className="font-mono">{project.key}</Badge>
                <span>{project.role === "OWNER" ? "所有者" : "成员"}</span>
                <span aria-hidden="true">·</span>
                <span>{project.memberCount} 名成员</span>
                {archived ? (
                  <Badge tone="warning" icon={<Archive className="h-3 w-3" />}>
                    已归档 · 只读
                  </Badge>
                ) : null}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link
              href={`/app/projects/${project.id}/trash`}
              className={buttonVariants({ variant: "secondary" })}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              回收站
            </Link>
            {archived ? null : (
              <Button
                type="button"
                onClick={() => {
                  setListError(null);
                  if (creating && !confirmLeave()) return;
                  setCreating((prev) => !prev);
                }}
                aria-expanded={creating}
                aria-controls="task-create-form"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>{creating ? "收起表单" : "新建任务"}</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* 创建表单：展开在页头之下 */}
      {creating && !archived ? (
        <div id="task-create-form" className="mb-6">
          <TaskCreateForm
            projectId={project.id}
            onCreated={async () => {
              // toast（「任务已创建」）由表单在成功分支自行发出。
              setCreating(false);
              // 新任务由刷新后的服务端 props 提供，表单成功后收起。
              router.refresh();
            }}
            onCancelled={() => setCreating(false)}
            onUnauthorized={goToLogin}
          />
        </div>
      ) : null}

      <InlineError className="mb-4">{listError}</InlineError>

      {tasks.length === 0 ? (
        archived ? (
          <EmptyState
            icon={<Undo2 className="h-6 w-6" />}
            title="项目已归档"
            description="归档项目处于只读状态，无法创建新任务。恢复项目后可继续。"
          />
        ) : hasActiveFilters ? (
          // B9 修复：筛选无结果 ≠ 没有任何任务；给出清除筛选的明确下一步。
          <EmptyState
            icon={<Undo2 className="h-6 w-6" />}
            title="没有符合筛选的任务"
            description="换个关键词或清除筛选后，可查看项目的全部任务。"
            action={
              <Link href={tasksPath} className={buttonVariants({ variant: "secondary", size: "lg" })}>
                清除筛选
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<Undo2 className="h-6 w-6" />}
            title="还没有任务"
            description="创建第一个任务，就能在列表中切换状态、设定优先级与截止日。"
            action={
              <Button
                type="button"
                size="lg"
                onClick={() => {
                  setListError(null);
                  setCreating(true);
                }}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                新建任务
              </Button>
            }
          />
        )
      ) : (
        <TaskTable
          tasks={tasks}
          today={today}
          isOwner={isOwner}
          userId={userId}
          archived={archived}
          onUnauthorized={goToLogin}
        />
      )}

      {hasMore ? (
        <div className="mt-6 flex justify-center">
          <Button
            type="button"
            variant="secondary"
            disabled={loadingMore}
            aria-busy={loadingMore || undefined}
            onClick={() => {
              void handleLoadMore();
            }}
          >
            {loadingMore ? <Spinner /> : null}
            <span>{loadingMore ? "正在加载…" : "加载更多"}</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 任务列表（B7 修复，docs/02 §4）：
 *  - 平板/桌面（md+）：语义 table（列头可扫读），行内直接切换状态（Select）、
 *    删除（确认 Dialog）；
 *  - 手机（<md）：转为任务行卡片，保留编号、标题、状态、优先级、负责人、截止日
 *    与删除菜单，不再强制横向滚动宽表格。两种形态共用同一组行内交互组件，
 *    键盘/读屏语义等价（列表 + 链接 + 控件）。
 */
function TaskTable({
  tasks,
  today,
  isOwner,
  userId,
  archived,
  onUnauthorized,
}: {
  tasks: TaskSummaryDTO[];
  today: string;
  isOwner: boolean;
  userId: string;
  archived: boolean;
  onUnauthorized: () => void;
}) {
  return (
    <>
      <div className="relative hidden overflow-x-auto rounded-card border border-line bg-surface shadow-popover md:block">
        <table className="w-full min-w-[880px] border-collapse text-left">
          <caption className="sr-only">项目任务列表（按最近更新排序）</caption>
          <thead>
            <tr className="border-b border-line bg-surface-sunken text-caption text-foreground-muted">
              <th scope="col" className="px-4 py-2.5 font-medium">
                任务
              </th>
              <th scope="col" className="w-36 px-3 py-2.5 font-medium">
                状态
              </th>
              <th scope="col" className="w-20 px-3 py-2.5 font-medium">
                优先级
              </th>
              <th scope="col" className="w-32 px-3 py-2.5 font-medium">
                负责人
              </th>
              <th scope="col" className="w-28 px-3 py-2.5 font-medium">
                截止日
              </th>
              <th scope="col" className="w-14 px-3 py-2.5 font-medium">
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                canDelete={isOwner || task.creator.id === userId}
                archived={archived}
                onUnauthorized={onUnauthorized}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* 手机卡片形态（<md） */}
      <ul
        role="list"
        className="space-y-2 rounded-card border border-line bg-surface p-2 md:hidden"
        aria-label="项目任务列表（按最近更新排序）"
      >
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            today={today}
            canDelete={isOwner || task.creator.id === userId}
            archived={archived}
            onUnauthorized={onUnauthorized}
          />
        ))}
      </ul>
    </>
  );
}

/** 手机任务卡（B7）：与表格行等价的全部信息与操作，纵向布局适配 390px。 */
function TaskCard({
  task,
  today,
  canDelete,
  archived,
  onUnauthorized,
}: {
  task: TaskSummaryDTO;
  today: string;
  canDelete: boolean;
  archived: boolean;
  onUnauthorized: () => void;
}) {
  const path = usePathname();
  const search = useSearchParams();
  const target = new URLSearchParams(search.toString());
  target.set("task", task.id);
  const mutation = useTaskMutation();
  const due = getDueMeta(task.dueDate, today, task.status);
  const done = task.status === "DONE";

  return (
    <li
      className={cn(
        "rounded-control border border-line p-3",
        done && "bg-surface-sunken/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 font-mono text-caption text-foreground-muted">
            {task.identifier}
          </span>
          <Link
            href={path + "?" + target.toString()}
            // 卡片链接用独立属性（data-task-card-link）：与桌面表格行的
            // data-task-link 区分，桌面测试的属性选择器不会命中隐藏卡片。
            data-task-card-link={task.id}
            className={cn(
              "min-w-0 break-words text-label font-medium text-foreground",
              done && "line-through decoration-foreground-muted",
            )}
            title={task.title}
          >
            {task.title}
          </Link>
        </span>
        {canDelete && !archived ? (
          <TaskDeleteButton
            mutation={mutation}
            task={task}
            onUnauthorized={onUnauthorized}
          />
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <TaskStatusSelect
          mutation={mutation}
          task={task}
          disabled={archived}
          onUnauthorized={onUnauthorized}
        />
        <PriorityBadge priority={task.priority} />
        <DueBadge meta={due} />
        {task.assignee ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <Avatar name={task.assignee.name} size="sm" />
            <span className="min-w-0 truncate text-caption text-foreground-secondary">
              {task.assignee.name}
            </span>
          </span>
        ) : (
          <span className="text-caption text-foreground-muted">未分配</span>
        )}
      </div>
    </li>
  );
}

/** 单行任务：identifier（mono）+ 标题 + 行内交互。 */
function TaskRow({
  task,
  today,
  canDelete,
  archived,
  onUnauthorized,
}: {
  task: TaskSummaryDTO;
  today: string;
  canDelete: boolean;
  archived: boolean;
  onUnauthorized: () => void;
}) {
  const path = usePathname();
  const search = useSearchParams();
  const target = new URLSearchParams(search.toString());
  target.set("task", task.id);
  const mutation = useTaskMutation();
  const due = getDueMeta(task.dueDate, today, task.status);
  const done = task.status === "DONE";

  return (
    // F25 修复：完成态不再用整行 opacity 压低全部文字对比度；
    // 完成语义由标题删除线 + 状态徽标表达，各行文字对比度保持达标。
    <tr
      className={cn(
        "transition-colors duration-150 ease-standard hover:bg-surface-sunken",
        done && "bg-surface-sunken/40",
      )}
    >
      <th scope="row" className="px-4 py-3 font-normal">
        <span className="flex min-w-0 items-baseline gap-2.5">
          <span className="shrink-0 font-mono text-caption text-foreground-muted">
            {task.identifier}
          </span>
          <Link
            href={path + "?" + target.toString()}
            data-task-link={task.id}
            className={cn(
              "min-w-0 truncate text-label font-medium text-foreground",
              done && "line-through decoration-foreground-muted",
            )}
            title={task.title}
          >
            {task.title}
          </Link>
        </span>
      </th>
      <td className="px-3 py-2.5">
        <TaskStatusSelect
          mutation={mutation}
          task={task}
          disabled={archived}
          onUnauthorized={onUnauthorized}
        />
      </td>
      <td className="px-3 py-2.5">
        <PriorityBadge priority={task.priority} />
      </td>
      <td className="px-3 py-2.5">
        {task.assignee ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={task.assignee.name} size="sm" />
            <span className="min-w-0 truncate text-caption text-foreground-secondary">
              {task.assignee.name}
            </span>
          </span>
        ) : (
          <span className="text-caption text-foreground-muted">未分配</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <DueBadge meta={due} />
      </td>
      <td className="px-3 py-2.5">
        {canDelete && !archived ? (
          <TaskDeleteButton
            mutation={mutation}
            task={task}
            onUnauthorized={onUnauthorized}
          />
        ) : null}
      </td>
    </tr>
  );
}
