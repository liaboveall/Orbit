import Link from "next/link";
import { AlarmClock, CalendarDays, CircleDot, Inbox, Sun, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { MyTasksQueryDTO, OverviewDTO } from "@/contracts";

/**
 * 工作台的分类磁贴：每一格既是数字，也是筛选入口。
 * 这些集合互相重叠（逾期的任务也在「全部未完成」里），所以不画合计或占比。
 * 「已完成」没有计数，也不是待办，入口放在筛选条里（见 WorkbenchFilters）。
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
  const tiles: { bucket: string; label: string; count: number; icon: LucideIcon; fill: string }[] = [
    { bucket: "all_open", label: "全部未完成", count: overview.totalOpen, icon: Inbox, fill: "bg-project-blue" },
    { bucket: "overdue", label: "逾期", count: overview.overdue, icon: AlarmClock, fill: "bg-danger-fill" },
    { bucket: "today", label: "今天到期", count: overview.dueToday, icon: Sun, fill: "bg-project-orange" },
    { bucket: "upcoming", label: "未来 7 天", count: overview.upcoming, icon: CalendarDays, fill: "bg-project-purple" },
    { bucket: "in_progress", label: "进行中", count: overview.inProgress, icon: CircleDot, fill: "bg-project-teal" },
  ];

  return (
    <nav aria-label="任务分类" className="mb-6">
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-5 xl:gap-3">
        {tiles.map(({ bucket, label, count, icon: Icon, fill }, index) => {
          const active = activeBucket === bucket;
          return (
            // 手机两列放五格：第一格占满一行，其余两两成对。
            <li key={bucket} className={cn(index === 0 && "max-sm:col-span-2")}>
              <Link
                href={"/app/today?" + bucketQuery(query, bucket).toString()}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "surface-card flex h-full flex-col gap-3 rounded-card p-3.5 outline-none active:scale-[0.98]",
                  active
                    ? "bg-surface-solid shadow-[inset_0_0_0_1.5px_var(--color-brand),var(--shadow-card)]"
                    : "lift",
                )}
              >
                <span className="flex items-start justify-between">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_2px_6px_-2px_rgb(0_0_0/0.3)]",
                      fill,
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
                  </span>
                  <span className="text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
                    {count}
                  </span>
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

/** 分类链接的查询串：保留筛选，替换 bucket，去掉旧的 cursor。 */
export function bucketQuery(query: MyTasksQueryDTO, bucket: string): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "cursor" || key === "bucket" || value === undefined) continue;
    params.set(key, String(value));
  }
  params.set("bucket", bucket);
  return params;
}
