"use client";

import { CheckCircle2, Inbox, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import type { ProjectDTO, TaskSummaryDTO } from "@/contracts";
import { cn } from "@/lib/cn";
import { PROJECT_COLOR_DOT } from "@/lib/project-color";
import { Button, EmptyState, Skeleton, SkeletonBlock, useToast } from "@/components/ui";
import { DueBadge, PriorityBadge } from "@/features/tasks/priority-badge";
import {
  formatDateCN,
  getDueMeta,
  isOverdue,
} from "@/features/tasks/task-meta";
import { NoAccess, SampleError } from "@/features/shell/state-views";
import type { SampleState } from "@/features/shell/sample-state";
import { PROJECTS, SAMPLE_TODAY } from "@/features/shell/fixtures";
import {
  TODAY_OVERVIEW,
  TODAY_TASKS,
  TODAY_TASKS_ALL_DONE,
  TODAY_TASKS_EMPTY,
  TODAY_TASKS_LONG,
} from "./fixtures";

/**
 * 我的工作台视图（ORB-002）。
 *
 * docs/02 §5：顶部主张 + 用户时区日期；四个紧凑统计入口（逾期/今天/未来 7 天/进行中）
 * 是可点击筛选，有选中态与文本说明，集合非互斥故不显示合计饼图；正文用分组任务列表。
 * 六态：默认数据态；empty 提供「首次无任务」与「今天已完成」两种；其余见 state-views。
 * ⚠️ 数据来自 fixture，未连接真实后端。
 */

type FilterKey = "overdue" | "today" | "upcoming" | "inProgress";

const projectById = new Map<string, ProjectDTO>(
  PROJECTS.map((p) => [p.id, p]),
);

const STAT_CARDS: {
  key: FilterKey;
  label: string;
  count: number;
  hint: string;
}[] = [
  { key: "overdue", label: "逾期", count: TODAY_OVERVIEW.overdue, hint: "已过截止日仍未完成" },
  { key: "today", label: "今天", count: TODAY_OVERVIEW.dueToday, hint: "今天到期的任务" },
  { key: "upcoming", label: "未来 7 天", count: TODAY_OVERVIEW.upcoming, hint: "接下来一周内到期" },
  { key: "inProgress", label: "进行中", count: TODAY_OVERVIEW.inProgress, hint: "状态为进行中" },
];

function matches(task: TaskSummaryDTO, key: FilterKey): boolean {
  switch (key) {
    case "overdue":
      return isOverdue(task.dueDate, SAMPLE_TODAY, task.status);
    case "today":
      return task.dueDate === SAMPLE_TODAY;
    case "upcoming": {
      if (!task.dueDate) return false;
      const diff = getDueMeta(task.dueDate, SAMPLE_TODAY, task.status);
      return diff.tone === "soon" || diff.tone === "today";
    }
    case "inProgress":
      return task.status === "IN_PROGRESS";
  }
}

/** 任务在分组列表中的主归类（precedence：逾期 > 今天 > 未来 7 天 > 进行中 > 其它）。 */
function bucketOf(task: TaskSummaryDTO): string {
  if (isOverdue(task.dueDate, SAMPLE_TODAY, task.status)) return "逾期";
  if (task.dueDate === SAMPLE_TODAY) return "今天";
  const meta = getDueMeta(task.dueDate, SAMPLE_TODAY, task.status);
  if (meta.tone === "soon") return "未来 7 天";
  if (task.status === "IN_PROGRESS") return "进行中";
  return "其它";
}

const BUCKET_ORDER = ["逾期", "今天", "未来 7 天", "进行中", "其它"];

function TaskRow({ task }: { task: TaskSummaryDTO }) {
  const project = projectById.get(task.projectId);
  const due = getDueMeta(task.dueDate, SAMPLE_TODAY, task.status);
  return (
    <li className="flex items-start gap-3 rounded-card border border-line bg-surface p-3 transition-colors duration-150 ease-standard hover:border-line-strong">
      <span
        className={cn(
          "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
          project ? PROJECT_COLOR_DOT[project.color] : "bg-project-gray",
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-label font-medium text-foreground [overflow-wrap:anywhere] line-clamp-2">
          {task.title}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-foreground-muted">
          {project ? (
            <span className="truncate">{project.name}</span>
          ) : null}
          <span>{task.identifier}</span>
          <DueBadge meta={due} />
          {task.subtaskTotal > 0 ? (
            <span>
              子任务 {task.subtaskCompleted}/{task.subtaskTotal}
            </span>
          ) : null}
          {task.commentCount > 0 ? <span>评论 {task.commentCount}</span> : null}
        </p>
      </div>
      <PriorityBadge priority={task.priority} className="shrink-0" />
    </li>
  );
}

export function TodayView({ state }: { state: SampleState }) {
  const { toast } = useToast();
  const [filters, setFilters] = useState<FilterKey[]>([]);
  const [emptyVariant, setEmptyVariant] = useState<"first" | "done">("first");

  // 权限态：工作台需登录 → 未登录/过期统一走会话失效提示。
  if (state === "permission") {
    return <NoAccess reason="session" />;
  }

  const dataset =
    state === "long-content"
      ? TODAY_TASKS_LONG
      : state === "empty"
        ? emptyVariant === "first"
          ? TODAY_TASKS_EMPTY
          : TODAY_TASKS_ALL_DONE
        : TODAY_TASKS;

  const visible =
    filters.length === 0
      ? dataset
      : dataset.filter((t) => filters.some((f) => matches(t, f)));

  const grouped = BUCKET_ORDER.map((bucket) => ({
    bucket,
    tasks: visible.filter((t) => bucketOf(t) === bucket),
  })).filter((g) => g.tasks.length > 0);

  function toggleFilter(key: FilterKey) {
    setFilters((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  const createProject = () =>
    toast({
      title: "样例模式：未连接真实后端",
      description: "创建项目对话框属后续里程碑，这里不发起真实请求。",
    });

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* 顶部主张 + 时区日期 */}
      {state === "loading" ? (
        <SkeletonBlock label="工作台加载中" className="space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-40" />
        </SkeletonBlock>
      ) : (
        <header className="space-y-1">
          <h1 className="text-page font-semibold tracking-tight text-foreground">
            今天，先把重要的事做好。
          </h1>
          <p className="text-label text-foreground-secondary">
            {formatDateCN(TODAY_OVERVIEW.today)} · {TODAY_OVERVIEW.timezone}
          </p>
        </header>
      )}

      {/* 四个统计入口（可点击筛选，非互斥，有选中态 + 文本说明） */}
      <section
        aria-label="任务统计与筛选"
        className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {state === "loading"
          ? Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-card" />
            ))
          : STAT_CARDS.map((card) => {
              const active = filters.includes(card.key);
              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => toggleFilter(card.key)}
                  aria-pressed={active}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-card border p-3 text-left outline-none",
                    "transition-colors duration-150 ease-standard",
                    active
                      ? "border-brand bg-brand-soft"
                      : "border-line bg-surface hover:border-line-strong",
                  )}
                >
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-page font-semibold text-foreground">
                      {card.count}
                    </span>
                    <span
                      className={cn(
                        "text-label font-medium",
                        active ? "text-brand" : "text-foreground-secondary",
                      )}
                    >
                      {card.label}
                    </span>
                  </span>
                  <span className="text-caption text-foreground-muted">
                    {active ? "已选中 · 点击取消筛选" : card.hint}
                  </span>
                </button>
              );
            })}
      </section>

      {/* 错误态：局部错误 + 重试 + 保留草稿说明（外壳与筛选仍在，尺寸稳定） */}
      {state === "error" ? (
        <SampleError
          className="mt-6"
          message="加载我的任务失败，请检查网络后重试。"
        />
      ) : null}

      {/* 正文分组任务列表 */}
      {state === "loading" ? (
        <SkeletonBlock label="任务列表加载中" className="mt-6 space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-card" />
          ))}
        </SkeletonBlock>
      ) : state === "error" ? null : state === "empty" ? (
        <div className="mt-6 space-y-4">
          {/* 两种空态切换：首次无任务 / 今天全部完成 */}
          <div
            role="group"
            aria-label="空态样例切换"
            className="flex gap-2 text-caption"
          >
            {(["first", "done"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setEmptyVariant(v)}
                aria-pressed={emptyVariant === v}
                className={cn(
                  "rounded-control px-2 py-1 outline-none",
                  emptyVariant === v
                    ? "bg-brand text-foreground-invert"
                    : "bg-surface-sunken text-foreground-secondary",
                )}
              >
                {v === "first" ? "首次无任务" : "今天已完成"}
              </button>
            ))}
          </div>

          {emptyVariant === "first" ? (
            <EmptyState
              icon={<Inbox className="h-6 w-6" />}
              title="还没有分配给你的任务"
              description="创建一个项目，开始安排第一步。"
              action={
                <Button onClick={createProject}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  创建项目
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<CheckCircle2 className="h-6 w-6" />}
              title="今天安排的任务已完成"
              description="可以休息一下，或看看未来 7 天还有什么要准备。"
            />
          )}
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={<Sparkles className="h-6 w-6" />}
          title="没有匹配的任务"
          description="当前筛选条件下没有任务，试试取消部分筛选。"
          action={
            <Button variant="secondary" onClick={() => setFilters([])}>
              清除筛选
            </Button>
          }
        />
      ) : (
        <div className="mt-6 space-y-6">
          {grouped.map((group) => (
            <section key={group.bucket} aria-labelledby={`grp-${group.bucket}`}>
              <h2
                id={`grp-${group.bucket}`}
                className="mb-2 flex items-center gap-2 text-section font-semibold text-foreground"
              >
                {group.bucket}
                <span className="text-caption font-normal text-foreground-muted">
                  {group.tasks.length}
                </span>
              </h2>
              <ul className="space-y-2">
                {group.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
