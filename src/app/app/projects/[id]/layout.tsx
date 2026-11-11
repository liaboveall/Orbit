import type { ReactNode } from "react";
import { ProjectBar } from "@/features/projects/project-bar";
import { loadProject } from "./_data";

/**
 * 项目内所有页面共用的框架：顶部一行是项目名和分区导航，吸顶；下面是各分区的内容。
 * 项目由 loadProject 读取，与页面共用同一次查询。
 */
export default async function ProjectLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: ReactNode;
}) {
  const { project } = await loadProject((await params).id);
  return (
    <div className="md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-x-5">
      <ProjectBar project={project} />
      <div className="md:col-span-2">{children}</div>
    </div>
  );
}
