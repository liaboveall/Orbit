"use client";

import Link from "next/link";
import { AlarmClock, CalendarDays, Check, CircleDot, Inbox, Sun, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { MyTasksQueryDTO, OverviewDTO } from "@/contracts";

/**
 * 工作台分类：每个磁贴既是统计又是筛选入口。
 * 切换时保留搜索、项目、优先级和排序，只替换分类并丢弃旧游标。
 * 计数由服务端按全量口径计算，不受当前搜索影响。
 */
export function WorkbenchStats({
  overview,
  query,
  activeBucket,
}: {
  overview: OverviewDTO;
  query: MyTasksQueryDTO;
  activeBucket: string;
}) {
  const tiles: { bucket: string; label: string; count?: number; icon: LucideIcon; fill: string }[] = [
    { bucket: "all_open", label: "全部未完成", count: overview.totalOpen, icon: Inbox, fill: "bg-project-blue" },
    { bucket: "overdue", label: "逾期", count: overview.overdue, icon: AlarmClock, fill: "bg-danger-fill" },
    { bucket: "today", label: "今天到期", count: overview.dueToday, icon: Sun, fill: "bg-project-orange" },
    { bucket: "upcoming", label: "未来 7 天", count: overview.upcoming, icon: CalendarDays, fill: "bg-project-purple" },
    { bucket: "in_progress", label: "进行中", count: overview.inProgress, icon: CircleDot, fill: "bg-project-teal" },
    { bucket: "done", label: "已完成", icon: Check, fill: "bg-project-green" },
  ];

  return (
    <nav aria-label="任务分类" className="mb-6">
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map(({ bucket, label, count, icon: Icon, fill }) => {
          const active = activeBucket === bucket;
          return (
            <li key={bucket}>
              <Link
                href={"/app/today?" + bucketQuery(query, bucket).toString()}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "glass-card flex h-full flex-col gap-2.5 rounded-[18px] p-3.5 outline-none active:scale-[0.98]",
                  active ? "shadow-[inset_0_0_0_1.5px_var(--color-brand)]" : "lift",
                )}
              >
                <span className="flex items-start justify-between">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]",
                      fill,
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  {count !== undefined ? (
                    <span className="text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
                      {count}
                    </span>
                  ) : null}
                </span>
                <span className="text-label font-medium text-foreground-secondary">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 构造分类链接查询串：保留筛选，替换 bucket，删除旧 cursor。 */
export function bucketQuery(query: MyTasksQueryDTO, bucket: string): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "cursor" || key === "bucket" || value === undefined) continue;
    params.set(key, String(value));
  }
  params.set("bucket", bucket);
  return params;
}
