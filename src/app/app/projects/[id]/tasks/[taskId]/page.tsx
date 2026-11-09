import { dateInTimezone } from "@/lib/calendar";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requirePageUser } from "@/server/auth/page-session";
import { DomainError } from "@/server/http/errors";
import { getProject, listMembers } from "@/server/modules/project";
import { findProjectTask } from "@/server/modules/task";
import { TaskDetailClient } from "@/features/tasks/real/task-detail-client";

/**
 * /app/projects/[id]/tasks/[taskId] · 任务详情「独立页」模式（ORB-010）。
 *
 * Server Component 通过领域服务读取任务详情与项目关系：
 *  - requirePageUser → 未认证重定向登录页、读取超额跳转限流说明页；
 *  - `getProject` 内含成员关系判定：非成员/不存在 → NOT_FOUND → 404，不泄露信息；
 *  - `findProjectTask` 按 task+project 双重校验归属：项目可访问但任务不存在、已删除或属于
 *    其他项目时返回 null，客户端显示「任务已删除」并保留已打开编辑器中的草稿，
 *    不让一次后台刷新把整页变成不可访问；
 *  - 行内编辑走 PATCH /api/v1 端点，成功后 `router.refresh()` 刷新服务端数据。
 */

export const metadata: Metadata = {
  title: "任务详情 · Orbit",
};
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string; taskId: string }>;
};

export default async function TaskDetailPage({ params }: PageProps) {
  const { id: routeProjectId, taskId } = await params;
  const sessionUser = await requirePageUser();

  let project;
  try {
    project = await getProject(routeProjectId, sessionUser.id);
  } catch (error) {
    // NOT_FOUND → 404，避免泄露项目是否存在
    if (error instanceof DomainError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  const [taskDetail, members] = await Promise.all([
    findProjectTask(taskId, project.id, sessionUser.id),
    listMembers(project.id, sessionUser.id),
  ]);
  return (
    <div className="space-y-3">
      <Link
        href={`/app/projects/${routeProjectId}/board`}
        className="inline-flex items-center gap-1 rounded-full text-label font-medium text-brand-ink outline-none hover:opacity-80"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        返回看板
      </Link>

      <div className="glass-card w-full max-w-3xl overflow-clip rounded-card">
        <TaskDetailClient
          members={members}
          key={taskId}
          taskDetail={taskDetail}
          projectId={project.id}
          currentUserId={sessionUser.id}
          today={dateInTimezone(sessionUser.timezone)}
          readOnly={project.archivedAt !== null}
          isProjectOwner={project.role === "OWNER"}
          canDelete={taskDetail !== null && (project.role === "OWNER" || taskDetail.creator.id === sessionUser.id)}
        />
      </div>
    </div>
  );
}
