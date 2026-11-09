import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectSettingsForm } from "@/features/projects/project-settings-form";
import { requirePageUser } from "@/server/auth/page-session";
import { DomainError } from "@/server/http/errors";
import { getProject } from "@/server/modules/project";

/**
 * /app/projects/[id]/settings —— 项目设置（M4 / ORB-007，owner-only）。
 *
 * Server Component 权威读取（与 members/activity 同范式）：
 *  1. requirePageUser → 未认证重定向登录页、读取超额跳转限流说明页；
 *  2. getProject 判定成员关系（非成员/不存在 → notFound()）并取得 role；
 *  3. owner → 渲染 ProjectSettingsForm（资料编辑 + 归档/恢复交互在客户端组件内）；
 *     非 owner → 渲染权限拒绝视图（服务端权威，PATCH 仍会 403）。
 *
 * 缓存：读取 headers() 属动态渲染，另显式 force-dynamic。
 */

export const metadata: Metadata = { title: "项目设置 · Orbit" };
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectSettingsPage({ params }: PageProps) {
  const { id } = await params;
  const sessionUser = await requirePageUser();

  let project;
  try {
    project = await getProject(id, sessionUser.id);
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const tasksPath = `/app/projects/${project.id}/tasks`;
  const isOwner = project.role === "OWNER";

  return (
    <div className="w-full max-w-3xl">
      <PageHeader
        eyebrow={project.name}
        title="项目设置"
        description="管理项目资料与归档状态（仅项目所有者可修改）。"
      />

      {isOwner ? (
        <ProjectSettingsForm project={project} />
      ) : (
        <EmptyState
          icon={<ShieldAlert className="h-6 w-6" />}
          title="无权限访问"
          description="只有项目所有者可以修改项目设置。如需变更，请联系项目所有者。"
          action={
            <Link href={tasksPath} className={buttonVariants({ size: "lg" })}>
              返回任务列表
            </Link>
          }
        />
      )}
    </div>
  );
}
