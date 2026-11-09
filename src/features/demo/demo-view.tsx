"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { Plus, Search } from "lucide-react";
import {
  Avatar,
  Button,
  buttonVariants,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  NativeSelect,
  PageHeader,
  Segments,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { TaskResourceCounts } from "@/features/board/task-resource-counts";
import { ProjectGlyph } from "@/features/projects/project-glyph";
import { OrbitWordmark } from "@/features/shell/orbit-logo";
import { DueBadge, PriorityBadge } from "@/features/tasks/priority-badge";
import { StatusGlyph } from "@/features/tasks/status-glyph";
import { getDueMeta, STATUS_COLUMN_ORDER, STATUS_LABEL } from "@/features/tasks/task-meta";
import { DEMO_DATE } from "./board-data";
import { DemoTaskCard } from "./demo-task-card";
import { DEMO_PROJECTS, demoTasks } from "./fixtures";

type View = "board" | "list" | "activity";

const VIEW_LABEL: Record<View, string> = { board: "看板", list: "列表", activity: "活动" };

const ACTIVITY = (name: string) => [
  { who: "小林", what: `创建了项目「${name}」。` },
  { who: "小周", what: "完成了报名表单任务。" },
  { who: "小陈", what: "添加了验收清单。" },
];

/** 公开演示：只使用合成数据，这个模块没有 API 客户端、会话或数据库依赖。 */
export function DemoView() {
  const [projectKey, setProjectKey] = useState("CAMP");
  const allTasks = demoTasks(projectKey);
  const project = DEMO_PROJECTS.find((p) => p.key === projectKey)!;
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("board");
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const tasks = allTasks.filter((t) => `${t.identifier} ${t.title}`.toLowerCase().includes(query.toLowerCase()));
  const task = allTasks.find((t) => t.id === selected);
  const inColumn = (status: (typeof STATUS_COLUMN_ORDER)[number]) => tasks.filter((t) => t.status === status);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-3 z-20 flex justify-center px-4">
        <div className="glass flex w-full max-w-[1248px] items-center justify-between gap-3 rounded-full py-1.5 pl-4 pr-1.5">
          <Link href="/" aria-label="Orbit 首页" className="shrink-0 rounded-[10px] outline-none">
            <OrbitWordmark />
          </Link>
          <Link href="/auth/register" className={buttonVariants({ size: "sm" })}>
            免费创建项目
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-4 pb-24 pt-8 md:px-8">
        <PageHeader
          leading={<ProjectGlyph name={project.name} color="BLUE" size="lg" />}
          eyebrow={`只读演示 · 日期快照 ${DEMO_DATE}`}
          title={project.name}
          actions={
            <Button onClick={() => setNotice("演示为只读。注册后即可创建任务、发表评论和上传附件。")}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              新建任务
            </Button>
          }
        />

        <div className="mb-5 flex flex-wrap items-center gap-2">
          <nav aria-label="演示视图" className="max-w-full">
            <Segments
              activeKey={view}
              className="inline-flex rounded-full bg-surface-sunken p-1"
              style={{ "--segment-inset": "4px" } as CSSProperties}
            >
              {(["board", "list", "activity"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  data-active={view === v || undefined}
                  onClick={() => setView(v)}
                  className={cn(
                    "h-8 rounded-full px-4 text-label font-medium outline-none transition-colors duration-200",
                    view === v ? "text-foreground" : "text-foreground-secondary hover:text-foreground",
                  )}
                >
                  {VIEW_LABEL[v]}
                </button>
              ))}
            </Segments>
          </nav>
          <NativeSelect
            aria-label="演示项目"
            wrapperClassName="max-w-56"
            value={projectKey}
            onChange={(e) => {
              setProjectKey(e.target.value);
              setSelected(null);
              setQuery("");
            }}
          >
            {DEMO_PROJECTS.map((p) => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </NativeSelect>
          <label className="glass-chip relative flex h-11 min-w-48 flex-1 items-center rounded-full pl-9 pr-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring sm:max-w-72 md:h-9">
            <Search className="absolute left-3 h-4 w-4 text-foreground-muted" aria-hidden="true" />
            <input
              type="text"
              aria-label="搜索演示任务"
              placeholder="搜索任务标题或编号"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="field w-full min-w-0 bg-transparent text-body text-foreground outline-none placeholder:text-foreground-muted md:text-label"
            />
          </label>
        </div>

        <p role="status" className={cn("text-label text-brand-ink", notice && "mb-4")}>{notice}</p>

        {view === "activity" ? (
          <section aria-label="演示活动" className="max-w-3xl">
            <h2 className="mb-3 text-section font-semibold tracking-[-0.015em]">项目动态（演示）</h2>
            <ol className="glass-card divide-y divide-line overflow-hidden rounded-card">
              {ACTIVITY(project.name).map((item) => (
                <li key={item.what} className="flex items-center gap-3 px-4 py-3 text-label">
                  <Avatar name={item.who} size="md" />
                  <span>
                    <span className="font-medium">{item.who}</span>
                    <span className="text-foreground-secondary"> {item.what}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : tasks.length === 0 ? (
          <p className="glass-card rounded-card px-6 py-16 text-center text-label text-foreground-secondary">
            没有匹配的任务，试试其他关键词。
          </p>
        ) : view === "board" ? (
          <div className="grid items-start gap-3 md:grid-cols-3 xl:gap-4">
            {STATUS_COLUMN_ORDER.map((status) => (
              <section key={status} aria-label={STATUS_LABEL[status]} className="rounded-card bg-surface-tray p-2">
                <h2 className="mb-1.5 flex items-center justify-between px-2 py-1 text-label font-semibold">
                  <span className="flex items-center gap-2">
                    <StatusGlyph status={status} className="h-4 w-4" />
                    {STATUS_LABEL[status]}
                  </span>
                  <span className="tabular-nums font-medium text-foreground-muted">{inColumn(status).length}</span>
                </h2>
                <div className="space-y-2">
                  {inColumn(status).map((t) => (
                    <DemoTaskCard
                      key={t.id}
                      task={t}
                      onOpen={() => setSelected(t.id)}
                      onChangeStatus={() => setNotice("演示任务为只读，注册后可在自己的项目中移动任务。")}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            {STATUS_COLUMN_ORDER.map((status) => (
              <section key={status} aria-label={STATUS_LABEL[status]}>
                <h2 className="mb-2 flex items-center gap-2 px-1 text-label font-semibold">
                  {STATUS_LABEL[status]}
                  <span className="tabular-nums font-medium text-foreground-muted">{inColumn(status).length}</span>
                </h2>
                <ul className="glass-card divide-y divide-line overflow-hidden rounded-card">
                  {inColumn(status).map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(t.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors duration-150 -outline-offset-2 hover:bg-surface-sunken"
                      >
                        <StatusGlyph status={t.status} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-label font-medium [overflow-wrap:anywhere]">{t.title}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-caption text-foreground-muted">
                            <span className="tabular-nums">{t.identifier}</span>
                            <TaskResourceCounts task={t} />
                          </span>
                        </span>
                        {t.priority === "HIGH" ? <PriorityBadge priority={t.priority} /> : null}
                        <DueBadge meta={getDueMeta(t.dueDate, DEMO_DATE, t.status)} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <Dialog open={!!task} onOpenChange={(open) => { if (!open) setSelected(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{task?.title ?? "任务详情"}</DialogTitle>
              <DialogDescription>合成任务详情 · 不读取或修改私人项目</DialogDescription>
            </DialogHeader>
            {task && (
              <div className="space-y-5 text-label">
                <dl className="divide-y divide-line rounded-[16px] bg-surface-sunken">
                  {[
                    ["编号", task.identifier],
                    ["状态", STATUS_LABEL[task.status]],
                    ["负责人", task.assignee?.name ?? "未分配"],
                  ].map(([term, value]) => (
                    <div key={term} className="flex min-h-10 items-center justify-between gap-3 px-4">
                      <dt className="text-foreground-secondary">{term}</dt>
                      <dd className="tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
                <section>
                  <h3 className="mb-1.5 font-semibold">验收清单</h3>
                  <ul className="list-inside list-disc space-y-1 text-foreground-secondary">
                    <li>键盘可以完成主要操作</li>
                    <li>错误时保留已输入的内容</li>
                  </ul>
                </section>
                <section>
                  <h3 className="mb-1.5 font-semibold">评论（演示）</h3>
                  <p className="text-foreground-secondary">小周：已核对交互，等待验收。</p>
                  <p className="mt-1 text-foreground-secondary">附件样例：验收说明.txt（演示占位）</p>
                </section>
                <Link href="/auth/register" className={buttonVariants({ variant: "secondary" })}>
                  注册后参与真实协作
                </Link>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
