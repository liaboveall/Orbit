"use client";

import Link from "next/link";
import { useState } from "react";
import { Info, Plus, SearchX } from "lucide-react";
import type { TaskStatus, TaskSummaryDTO } from "@/contracts";
import {
  Avatar,
  Badge,
  Button,
  buttonVariants,
  Drawer,
  DrawerContent,
  EmptyState,
  NativeSelect,
  SearchField,
  Segments,
} from "@/components/ui";
import { ProjectGlyph } from "@/features/projects/project-glyph";
import { OrbitWordmark } from "@/features/shell/orbit-logo";
import { DueBadge, PriorityMark } from "@/features/tasks/priority-badge";
import { StatusGlyph } from "@/features/tasks/status-glyph";
import { getDueMeta, STATUS_COLUMN_ORDER, STATUS_LABEL } from "@/features/tasks/task-meta";
import { cn } from "@/lib/cn";
import { DEMO_DATE } from "./board-data";
import { DemoTaskCard } from "./demo-task-card";
import { DemoTaskDetail } from "./demo-task-detail";
import { demoActivity, DEMO_PROJECTS, demoTasks } from "./fixtures";

type View = "board" | "list" | "activity";

const VIEWS: { key: View; label: string }[] = [
  { key: "board", label: "看板" },
  { key: "list", label: "列表" },
  { key: "activity", label: "活动" },
];

const READ_ONLY = "演示为只读。注册后即可创建任务、发表评论和上传附件。";

/**
 * 公开演示：外观与真实项目页一致，数据全部是合成的。
 * 这个模块没有 API 客户端、会话或数据库依赖，所有写操作只给出提示。
 */
export function DemoView() {
  const [projectKey, setProjectKey] = useState("CAMP");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("board");
  // 手机上看板一次显示一列，和真实看板一致。
  const [column, setColumn] = useState<TaskStatus>("TODO");
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const project = DEMO_PROJECTS.find((item) => item.key === projectKey)!;
  const allTasks = demoTasks(projectKey);
  const keyword = query.trim().toLowerCase();
  const tasks = allTasks.filter((task) => `${task.identifier} ${task.title}`.toLowerCase().includes(keyword));
  const task = allTasks.find((item) => item.id === selected);
  const inColumn = (status: TaskStatus) => tasks.filter((item) => item.status === status);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-3 z-20 flex justify-center px-4">
        <div
          data-lens=""
          className="glass flex w-full max-w-[1248px] items-center gap-3 rounded-full py-1.5 pl-5 pr-1.5"
        >
          <Link href="/" aria-label="Orbit 首页" className="shrink-0 rounded-control outline-none">
            <OrbitWordmark />
          </Link>
          <Badge tone="brand" className="max-sm:hidden">
            只读演示
          </Badge>
          <Link href="/auth/register" className={buttonVariants({ size: "sm", className: "ml-auto max-sm:h-9" })}>
            免费创建项目
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-4 pb-24 pt-7 md:px-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          <div className="flex min-w-0 items-center gap-3">
            <ProjectGlyph name={project.name} color={project.color} size="md" />
            <div className="min-w-0">
              <h1 className="truncate text-title font-semibold tracking-[-0.01em] text-foreground" title={project.name}>
                {project.name}
              </h1>
              <p className="truncate text-caption text-foreground-muted">
                <span className="tabular-nums">{project.key}</span>
                <span aria-hidden="true"> · </span>
                {project.members} 名成员
                <span aria-hidden="true"> · </span>
                日期快照 {DEMO_DATE}
              </p>
            </div>
          </div>
          <nav aria-label="演示视图" data-lens="" className="glass rounded-full p-1">
            <Segments activeKey={view} className="flex items-center">
              {VIEWS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  data-active={view === key || undefined}
                  onClick={() => setView(key)}
                  className={cn(
                    "h-9 rounded-full px-4 text-label font-medium outline-none transition-colors duration-200",
                    view === key ? "text-foreground" : "text-foreground-secondary hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </Segments>
          </nav>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchField
            type="text"
            aria-label="搜索演示任务"
            placeholder="搜索标题或编号"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 basis-full sm:w-64 sm:flex-none sm:basis-auto"
          />
          <NativeSelect
            aria-label="演示项目"
            wrapperClassName="min-w-0 max-w-56"
            value={projectKey}
            onChange={(event) => {
              setProjectKey(event.target.value);
              setSelected(null);
              setQuery("");
            }}
          >
            {DEMO_PROJECTS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.name}
              </option>
            ))}
          </NativeSelect>
          <Button className="ml-auto shrink-0" onClick={() => setNotice(READ_ONLY)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            新建任务
          </Button>
        </div>

        <p
          role="status"
          className={cn(
            "text-label text-brand-ink",
            notice && "mb-4 flex animate-rise items-start gap-2 rounded-tile bg-brand-soft px-3.5 py-2.5",
          )}
        >
          {notice ? <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : null}
          {notice}
        </p>

        {view === "activity" ? (
          <section aria-labelledby="demo-activity-title" className="mx-auto max-w-3xl">
            <h2 id="demo-activity-title" className="mb-3 px-1 text-section font-semibold tracking-[-0.012em]">
              项目动态（演示）
            </h2>
            <ol className="surface-card divide-y divide-line overflow-hidden rounded-card">
              {demoActivity(project).map((item) => (
                <li key={`${item.who}-${item.when}`} className="flex items-center gap-3 px-4 py-3 text-label">
                  <Avatar name={item.who} size="md" />
                  <p className="min-w-0 flex-1">
                    <span className="font-medium text-foreground">{item.who}</span>
                    <span className="text-foreground-secondary"> {item.action}</span>
                    {item.ref ? (
                      <Badge className="ml-2 align-middle tabular-nums">{item.ref}</Badge>
                    ) : null}
                  </p>
                  <span className="shrink-0 text-caption text-foreground-muted">{item.when}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : tasks.length === 0 ? (
          <EmptyState icon={<SearchX className="h-6 w-6" />} title="没有匹配的任务，试试其他关键词。" />
        ) : view === "board" ? (
          <>
            <Segments
              role="group"
              aria-label="按状态查看"
              activeKey={column}
              className="mb-3 flex rounded-full bg-surface-sunken p-1 md:hidden"
            >
              {STATUS_COLUMN_ORDER.map((status) => (
                <button
                  key={status}
                  type="button"
                  aria-pressed={column === status}
                  data-active={column === status || undefined}
                  onClick={() => setColumn(status)}
                  className={cn(
                    "min-h-10 flex-1 rounded-full px-3 text-label font-medium outline-none transition-colors duration-200",
                    column === status ? "text-foreground" : "text-foreground-secondary",
                  )}
                >
                  {STATUS_LABEL[status]}
                  <span className="ml-1.5 tabular-nums text-foreground-muted">{inColumn(status).length}</span>
                </button>
              ))}
            </Segments>
            <div className="grid items-start gap-3 md:grid-cols-3 xl:gap-4">
              {STATUS_COLUMN_ORDER.map((status) => (
                <section
                  key={status}
                  aria-label={`${STATUS_LABEL[status]}列`}
                  className={cn(
                    "min-h-40 rounded-card bg-surface-tray p-1.5 shadow-[inset_0_0_0_0.5px_var(--color-line)]",
                    status !== column && "max-md:hidden",
                  )}
                >
                  <h2 className="flex h-10 items-center gap-2 px-2.5 text-label font-semibold max-md:sr-only">
                    <StatusGlyph status={status} className="h-4 w-4" />
                    {STATUS_LABEL[status]}
                    <span className="font-medium tabular-nums text-foreground-muted">{inColumn(status).length}</span>
                  </h2>
                  <div className="space-y-1.5">
                    {inColumn(status).map((item) => (
                      <DemoTaskCard
                        key={item.id}
                        task={item}
                        onOpen={() => setSelected(item.id)}
                        onChangeStatus={() => setNotice("演示任务为只读，注册后可在自己的项目中移动任务。")}
                      />
                    ))}
                  </div>
                  {inColumn(status).length === 0 ? (
                    <p className="py-10 text-center text-caption text-foreground-muted">暂无任务</p>
                  ) : null}
                </section>
              ))}
            </div>
          </>
        ) : (
          <DemoList tasks={tasks} onOpen={setSelected} />
        )}

        <Drawer
          open={Boolean(task)}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        >
          <DrawerContent
            side="right"
            closeLabel="关闭详情"
            className="w-full sm:w-[min(var(--task-panel-width),calc(100vw-20px))]"
          >
            {task ? <DemoTaskDetail task={task} /> : null}
          </DrawerContent>
        </Drawer>
      </main>
    </div>
  );
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

function StatusLabel({ status }: { status: TaskStatus }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-label text-foreground">
      <StatusGlyph status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

const titleButton =
  "min-w-0 rounded-[6px] text-left text-label font-medium text-foreground outline-none hover:text-brand-ink";

/** 列表视图：与真实任务列表相同的表格，手机上排成卡片。 */
function DemoList({ tasks, onOpen }: { tasks: TaskSummaryDTO[]; onOpen: (id: string) => void }) {
  return (
    <>
      <div className="surface-card relative hidden overflow-x-auto rounded-card md:block">
        <table className="w-full min-w-[600px] table-fixed border-collapse text-left">
          <caption className="sr-only">演示任务列表</caption>
          <thead>
            <tr className="border-b border-line text-caption text-foreground-muted">
              <th scope="col" className="py-2.5 pl-5 pr-3 font-medium">任务</th>
              <th scope="col" className="w-32 px-3 py-2.5 font-medium">状态</th>
              <th scope="col" className="w-24 px-3 py-2.5 font-medium">优先级</th>
              <th scope="col" className="hidden w-36 px-3 py-2.5 font-medium lg:table-cell">负责人</th>
              <th scope="col" className="w-36 py-2.5 pl-3 pr-5 font-medium">截止日</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tasks.map((task) => (
              <tr key={task.id} className="transition-colors duration-150 ease-standard hover:bg-surface-sunken">
                <th scope="row" className="py-3 pl-5 pr-3 font-normal">
                  <span className="flex min-w-0 items-baseline gap-2.5">
                    <span className="shrink-0 text-caption tabular-nums text-foreground-muted">{task.identifier}</span>
                    <button
                      type="button"
                      onClick={() => onOpen(task.id)}
                      title={task.title}
                      className={cn(titleButton, "truncate", task.status === "DONE" && "line-through decoration-foreground-muted")}
                    >
                      {task.title}
                    </button>
                  </span>
                </th>
                <td className="px-3 py-2">
                  <StatusLabel status={task.status} />
                </td>
                <td className="px-3 py-2">
                  <PriorityMark priority={task.priority} withLabel />
                </td>
                <td className="hidden px-3 py-2 lg:table-cell">
                  <Assignee task={task} />
                </td>
                <td className="py-2 pl-3 pr-5">
                  <DueBadge meta={getDueMeta(task.dueDate, DEMO_DATE, task.status)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul role="list" aria-label="演示任务列表" className="space-y-2 md:hidden">
        {tasks.map((task) => (
          <li key={task.id} className="surface-card rounded-tile p-3.5">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-caption tabular-nums text-foreground-muted">{task.identifier}</span>
              <button
                type="button"
                onClick={() => onOpen(task.id)}
                className={cn(titleButton, "[overflow-wrap:anywhere]", task.status === "DONE" && "line-through decoration-foreground-muted")}
              >
                {task.title}
              </button>
            </span>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <StatusLabel status={task.status} />
              <PriorityMark priority={task.priority} />
              <DueBadge meta={getDueMeta(task.dueDate, DEMO_DATE, task.status)} />
              <Assignee task={task} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
