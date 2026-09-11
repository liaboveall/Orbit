"use client";
import Link from "next/link";
import type { OverviewDTO } from "@/contracts";
export function WorkbenchStats({ overview }: { overview: OverviewDTO }) {
  const cards = [
    ["逾期任务", overview.overdue, "overdue"],
    ["今天到期", overview.dueToday, "today"],
    ["未来 7 天", overview.upcoming, "upcoming"],
    ["进行中", overview.inProgress, "in_progress"],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(([title, count, bucket]) => (
        <Link
          key={bucket}
          href={"/app/today?bucket=" + bucket}
          className="rounded-panel border border-line bg-surface p-5 focus-visible:outline-2 focus-visible:outline-brand"
        >
          <p className="text-caption text-foreground-muted">{title}</p>
          <p className="mt-2 text-3xl font-semibold">{count}</p>
        </Link>
      ))}
    </div>
  );
}
