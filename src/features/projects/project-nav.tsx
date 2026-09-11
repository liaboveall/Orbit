"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * 项目分区导航（M4 / Part 7，`/app/projects/[id]/layout`）。
 *
 * 横向 Tab 栏，覆盖项目全部子页：任务 / 看板 / 成员 / 邀请 / 活动 / 设置。
 * 遵循现有 TaskFilters 的导航范式（`<nav aria-label>` + Link + aria-current）；
 * 激活态由 usePathname 匹配当前 section（含 tasks/[taskId] 等嵌套路径）。
 *
 * 注：回收站（trash）是任务级功能，其入口由任务列表工具栏（task-list-client）提供；
 * 此处不再重复渲染「回收站」链接，避免任务页出现两个同名 link 触发 Playwright strict mode 冲突。
 *
 * 手机横向滚动（overflow-x-auto，隐藏滚动条），平板/桌面完整展开。
 * 边界（features 层）：仅消费 pathname，不导入 @/server / @/generated。
 */

type Section = {
  /** 项目下的路径后缀（不含前导斜杠），用于拼接与匹配。 */
  slug: string;
  label: string;
};

const SECTIONS: Section[] = [
  { slug: "tasks", label: "任务" },
  { slug: "board", label: "看板" },
  { slug: "members", label: "成员" },
  { slug: "invitations", label: "邀请" },
  { slug: "activity", label: "活动" },
  { slug: "settings", label: "设置" },
];

export type ProjectNavProps = {
  projectId: string;
};

export function ProjectNav({ projectId }: ProjectNavProps) {
  const pathname = usePathname();
  const base = `/app/projects/${projectId}`;

  return (
    <nav
      aria-label="项目分区"
      className="mb-6 -mx-4 overflow-x-auto border-b border-line px-4 md:-mx-6 md:px-6 xl:-mx-8 xl:px-8"
    >
      <ul className="flex min-w-max items-center gap-1">
        {SECTIONS.map((section) => {
          const href = `${base}/${section.slug}`;
          // 精确匹配或嵌套子路径（如 tasks/[taskId]）均视为激活。
          const active =
            pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={section.slug}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-10 items-center rounded-t-control border-b-2 px-3",
                  "text-label font-medium outline-none transition-colors duration-150 ease-standard",
                  "focus-visible:ring-2 focus-visible:ring-brand",
                  active
                    ? "border-brand text-brand"
                    : "border-transparent text-foreground-secondary hover:border-line-strong hover:text-foreground",
                )}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
