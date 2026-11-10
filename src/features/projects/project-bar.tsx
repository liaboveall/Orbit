"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Archive, Trash2 } from "lucide-react";
import type { ProjectDTO } from "@/contracts";
import { Badge, LinkLabel, Segments } from "@/components/ui";
import { cn } from "@/lib/cn";
import { projectColorAria } from "@/lib/project-color";
import { ProjectGlyph } from "./project-glyph";

/**
 * 项目栏：左边是项目名，右边是分区导航的玻璃胶囊。两者都吸顶，
 * 内容从它们下方滚过时在滚动边缘里变糊淡出。手机上只有胶囊吸顶。
 *
 * 这三个元素是项目布局网格的直接子元素（见 projects/[id]/layout.tsx），
 * 这样吸顶范围是整页而不是这一行。
 */

const SECTIONS = [
  { slug: "board", label: "看板" },
  { slug: "tasks", label: "列表" },
  { slug: "activity", label: "活动" },
  { slug: "members", label: "成员" },
  { slug: "settings", label: "设置" },
] as const;

/** 看板与列表是同一批任务的两种视图，互相切换时保留筛选。 */
const TASK_VIEWS = new Set<string>(["board", "tasks"]);

export function ProjectBar({ project }: { project: ProjectDTO }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const base = `/app/projects/${project.id}`;
  const [section, detail] = pathname.slice(base.length + 1).split("/");
  // 邀请是成员分区里的一页。
  const active = section === "invitations" ? "members" : section;
  // 独立任务详情页的 h1 是任务标题，项目名在那里只是上下文。
  const Name = section === "tasks" && detail ? "p" : "h1";

  const carried = new URLSearchParams(search.toString());
  for (const key of ["task", "cursor", "sort"]) carried.delete(key);
  const query = carried.size ? `?${carried}` : "";

  return (
    <>
      <div aria-hidden="true" className="pointer-events-none sticky top-0 z-10 col-span-full row-start-1 hidden self-stretch md:block">
        {/* 左右伸到主内容区的内边距为止（md 28px、xl 36px），再宽就会撑出横向滚动条。 */}
        <div className="scroll-edge absolute -inset-x-7 -bottom-7 -top-5 xl:-inset-x-9" />
      </div>

      <div className="z-20 col-start-1 row-start-1 mb-3 flex min-w-0 items-center gap-3 md:sticky md:top-0 md:mb-0 md:py-3">
        <ProjectGlyph name={project.name} color={project.color} size="md" />
        <div className="min-w-0">
          <Name className="truncate text-title font-semibold tracking-[-0.01em] text-foreground" title={project.name}>
            {project.name}
          </Name>
          <p className="flex items-center gap-1.5 truncate text-caption text-foreground-muted">
            <span className="tabular-nums">{project.key}</span>
            <span aria-hidden="true">·</span>
            <span>{project.memberCount} 名成员</span>
            <span className="sr-only">，{projectColorAria(project.color)}</span>
          </p>
        </div>
        {project.archivedAt ? (
          <Badge tone="warning" icon={<Archive className="h-3 w-3" />} className="shrink-0">
            已归档，只读
          </Badge>
        ) : null}
      </div>

      <div className="pointer-events-none sticky top-2 z-20 col-start-2 row-start-1 mb-5 flex md:top-0 md:mb-0 md:justify-end md:py-3">
        <nav
          aria-label="项目分区"
          data-lens=""
          className="glass pointer-events-auto flex min-w-0 max-w-full items-center rounded-full p-1"
        >
          <Segments activeKey={active} className="no-scrollbar min-w-0 overflow-x-auto rounded-full">
            <ul className="flex w-max items-center">
              {SECTIONS.map(({ slug, label }) => {
                const current = slug === active;
                const keepFilters = TASK_VIEWS.has(slug) && TASK_VIEWS.has(section ?? "") && !detail;
                return (
                  <li key={slug}>
                    <Link
                      href={`${base}/${slug}${keepFilters ? query : ""}`}
                      aria-current={current ? "page" : undefined}
                      data-active={current || undefined}
                      className={cn(
                        "flex h-9 items-center rounded-full px-3.5 text-label font-medium outline-none sm:px-4",
                        "transition-colors duration-200 ease-standard",
                        current ? "text-foreground" : "text-foreground-secondary hover:text-foreground",
                      )}
                    >
                      <LinkLabel>{label}</LinkLabel>
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
            aria-current={section === "trash" ? "page" : undefined}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full outline-none",
              "transition-colors duration-200 ease-standard",
              section === "trash"
                ? "surface-selected text-foreground"
                : "text-foreground-secondary hover:bg-surface-sunken hover:text-foreground",
            )}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Link>
        </nav>
      </div>
    </>
  );
}
