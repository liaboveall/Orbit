"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Trash2 } from "lucide-react";
import { LinkLabel } from "@/components/ui/link-label";
import { Segments } from "@/components/ui/segments";
import { cn } from "@/lib/cn";

/**
 * 项目分区导航：吸顶的玻璃胶囊，滚动时内容从它下方穿过。
 * 看板与列表是同一批任务的两种视图，切换时保留筛选条件。
 */

const SECTIONS = [
  { slug: "board", label: "看板" },
  { slug: "tasks", label: "列表" },
  { slug: "activity", label: "活动" },
  { slug: "members", label: "成员" },
  { slug: "invitations", label: "邀请" },
  { slug: "settings", label: "设置" },
] as const;

const TASK_VIEWS = new Set<string>(["board", "tasks"]);

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const base = `/app/projects/${projectId}`;
  const active = SECTIONS.find(
    (section) => pathname === `${base}/${section.slug}` || pathname.startsWith(`${base}/${section.slug}/`),
  )?.slug;

  const viewQuery = new URLSearchParams(search.toString());
  for (const key of ["task", "cursor", "sort"]) viewQuery.delete(key);
  const carried = viewQuery.size ? `?${viewQuery}` : "";

  const trashActive = pathname === `${base}/trash`;

  return (
    <div className="pointer-events-none sticky top-2 z-20 mb-6 md:top-3">
      <nav
        aria-label="项目分区"
        className="glass pointer-events-auto inline-flex max-w-full items-center rounded-full p-1"
      >
        <Segments activeKey={active} className="no-scrollbar min-w-0 overflow-x-auto rounded-full">
          <ul className="flex w-max items-center">
            {SECTIONS.map((section) => {
              const isActive = section.slug === active;
              const keepFilters = TASK_VIEWS.has(section.slug) && active !== undefined && TASK_VIEWS.has(active);
              return (
                <li key={section.slug}>
                  <Link
                    href={`${base}/${section.slug}${keepFilters ? carried : ""}`}
                    aria-current={isActive ? "page" : undefined}
                    data-active={isActive || undefined}
                    className={cn(
                      "flex h-9 items-center rounded-full px-4 text-label font-medium outline-none",
                      "transition-colors duration-200 ease-standard",
                      isActive ? "text-foreground" : "text-foreground-secondary hover:text-foreground",
                    )}
                  >
                    <LinkLabel>{section.label}</LinkLabel>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Segments>
        <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-line" />
        <Link
          href={`${base}/trash`}
          aria-label="回收站"
          title="回收站"
          aria-current={trashActive ? "page" : undefined}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full outline-none",
            "transition-colors duration-200 ease-standard",
            trashActive
              ? "selected-glass text-foreground"
              : "text-foreground-secondary hover:bg-surface-sunken hover:text-foreground",
          )}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Link>
      </nav>
    </div>
  );
}
