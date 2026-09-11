"use client";

import { CalendarClock, Flag, Timer, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import type { OverviewDTO } from "@/contracts";
import { useEffect, useState } from "react";

/**
 * 工作台仪表盘概览卡片（四分类计数）。
 * 数据来自 GET /api/v1/workbench，返回 OverviewDTO（timezone/today/overdue/dueToday/upcoming/inProgress/totalOpen）。
 * 每个卡片的数字可点击跳转到对应的任务列表视图（TODO: 路由规划待确定）。
 */
export function WorkbenchStats({ currentUserId }: { currentUserId: string }) {
  const [overview, setOverview] = useState<OverviewDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      // TODO: replace with real fetch to /api/v1/workbench
      setLoading(true);
      // Placeholder data for now - remove this when backend is ready
      await new Promise((resolve) => setTimeout(resolve, 500));
      setOverview({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        today: new Date().toISOString().split("T")[0] as string,
        overdue: 3,
        dueToday: 2,
        upcoming: 5,
        inProgress: 4,
        totalOpen: 10,
      });
      setLoading(false);
      setError(null);
    } catch {
      setLoading(false);
      setError("无法加载工作台统计数据");
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface p-5">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-8 w-full mt-3" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-center">
        <p className="text-caption">{error || "暂无数据"}</p>
      </div>
    );
  }

  const stats = [
    {
      title: "逾期任务",
      value: overview.overdue,
      icon: Flag,
      iconClass: "text-danger",
      color: "border-danger",
      bgColor: "bg-danger-soft",
      href: "/app/my?bucket=overdue",
    },
    {
      title: "今天到期",
      value: overview.dueToday,
      icon: CalendarClock,
      iconClass: "text-warning",
      color: "border-warning",
      bgColor: "bg-warning-soft",
      href: "/app/my?bucket=today",
    },
    {
      title: "未来 7 天",
      value: overview.upcoming,
      icon: Timer,
      iconClass: "text-info",
      color: "border-info",
      bgColor: "bg-info-soft",
      href: "/app/my?bucket=upcoming",
    },
    {
      title: "进行中",
      value: overview.inProgress,
      icon: TrendingUp,
      iconClass: "text-brand",
      color: "border-brand",
      bgColor: "bg-brand-soft",
      href: "/app/my?bucket=in_progress",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <a
            key={stat.title}
            href={stat.href}
            className={cn(
              "group relative overflow-hidden rounded-xl border p-5 transition-all hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              stat.color,
              "bg-surface"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-caption text-foreground-muted">{stat.title}</p>
                <p className="text-3xl font-bold text-foreground">{stat.value}</p>
              </div>
              <div
                className={cn(
                  "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
                  stat.bgColor
                )}
              >
                <Icon className={cn("h-6 w-6", stat.iconClass)} aria-hidden="true" />
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}
