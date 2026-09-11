import type { ReactNode } from "react";
import { ProjectNav } from "@/features/projects/project-nav";

/**
 * /app/projects/[id]/layout —— 项目分区布局（M4 / Part 7）。
 *
 * 在项目全部子页（任务 / 看板 / 成员 / 邀请 / 活动 / 回收站 / 设置）顶部渲染统一的
 * 分区导航 ProjectNav（客户端组件，用 usePathname 高亮当前 section）。
 *
 * 保持轻量：仅从 params 取 projectId，不做数据读取（授权与数据由各子页 Server
 * Component 权威负责，getProject 在页面内调用），避免与子页重复查询。
 */

type LayoutProps = {
  params: Promise<{ id: string }>;
  children: ReactNode;
};

export default async function ProjectLayout({ params, children }: LayoutProps) {
  const { id } = await params;
  return (
    <>
      <ProjectNav projectId={id} />
      {children}
    </>
  );
}
