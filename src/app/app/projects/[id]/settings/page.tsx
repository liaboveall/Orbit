import type { Metadata } from "next";
import { SectionHeader } from "@/components/ui/page-header";
import { ProjectSettingsForm } from "@/features/projects/project-settings-form";
import { loadProject } from "../_data";

/**
 * 项目设置。所有者可以修改资料和归档；其他成员只读查看项目资料，
 * 退出项目的入口在成员页。服务端对写操作仍会校验权限。
 */

export const metadata: Metadata = { title: "项目设置 · Orbit" };
export const dynamic = "force-dynamic";

export default async function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { project } = await loadProject((await params).id);
  const isOwner = project.role === "OWNER";

  return (
    <div className="mx-auto w-full max-w-3xl">
      <SectionHeader
        title="项目设置"
        description={isOwner ? "管理项目资料与归档状态。" : "只有项目所有者可以修改项目资料和归档状态。"}
      />

      {isOwner ? (
        <ProjectSettingsForm project={project} />
      ) : (
        <dl className="surface-card divide-y divide-line overflow-hidden rounded-card text-label">
          {[
            ["项目名称", project.name],
            ["项目标识", project.key],
            ["项目描述", project.description || "未填写"],
          ].map(([term, value]) => (
            <div key={term} className="flex flex-wrap gap-x-6 gap-y-1 px-5 py-3.5">
              <dt className="w-20 shrink-0 text-foreground-muted">{term}</dt>
              <dd className="min-w-0 flex-1 whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
