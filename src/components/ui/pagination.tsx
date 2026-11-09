"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";

/**
 * Pagination（ORB-002）：列表/看板分页控件（键盘可达）。
 *
 * 以 button 呈现，Tab 可聚焦、Enter/Space 可激活；当前页用 aria-current 标注，
 * 上一页/下一页有可访问名称。M0 仅作布局样例，onChange 由调用方接入。
 */

export type PaginationProps = {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  className?: string;
  /** 生成按钮可访问标签，默认「第 N 页」。 */
  itemLabel?: (page: number) => string;
};

/** 生成紧凑页码序列：首尾 + 当前页邻域，中间用省略号。 */
function pageRange(page: number, pageCount: number): (number | "gap")[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, pageCount, page, page - 1, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const result: (number | "gap")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) result.push("gap");
    result.push(p);
    prev = p;
  }
  return result;
}

export function Pagination({
  page,
  pageCount,
  onChange,
  className,
  itemLabel = (p) => `第 ${p} 页`,
}: PaginationProps) {
  if (pageCount <= 1) return null;
  return (
    <nav
      aria-label="分页"
      className={cn("flex items-center gap-1", className)}
    >
      <IconButton
        label="上一页"
        size="sm"
        variant="secondary"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft className="h-4 w-4" />
      </IconButton>

      {pageRange(page, pageCount).map((entry, i) =>
        entry === "gap" ? (
          <span
            key={`gap-${i}`}
            className="px-1 text-label text-foreground-muted"
            aria-hidden="true"
          >
            …
          </span>
        ) : (
          <button
            key={entry}
            type="button"
            onClick={() => onChange(entry)}
            aria-label={itemLabel(entry)}
            aria-current={entry === page ? "page" : undefined}
            className={cn(
              "h-8 min-w-8 rounded-full px-2 text-label font-medium outline-none",
              "transition-colors duration-150 ease-standard",
              entry === page
                ? "bg-brand text-foreground-invert"
                : "text-foreground-secondary hover:bg-surface-sunken hover:text-foreground",
            )}
          >
            {entry}
          </button>
        ),
      )}

      <IconButton
        label="下一页"
        size="sm"
        variant="secondary"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight className="h-4 w-4" />
      </IconButton>
    </nav>
  );
}
