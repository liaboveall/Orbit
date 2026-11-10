import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { TaskDetailClient } from "@/features/tasks/real/task-detail-client";
import { dateInTimezone } from "@/lib/calendar";
import { listMembers } from "@/server/modules/project";
import { findProjectTask } from "@/server/modules/task";
import { loadProject } from "../../_data";

/**
 * 可直达的任务详情页，与看板的侧面板共用同一个编辑器。
 *
 * 项目可访问但任务不存在、已删除或属于其它项目时，findProjectTask 返回 null：
 * 页面显示说明并保留已打开编辑器里的草稿，不让一次后台刷新把整页变成不可访问。
 */

export const metadata: Metadata = { title: "任务详情 · Orbit" };
export const dynamic = "force-dynamic";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const { user, project } = await loadProject(id);
  const [task, members] = await Promise.all([
    findProjectTask(taskId, project.id, user.id),
    listMembers(project.id, user.id),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link
        href={`/app/projects/${project.id}/board`}
        className="mb-3 inline-flex h-9 items-center gap-0.5 rounded-full pr-3 text-label font-medium text-brand-ink outline-none transition-colors hover:text-brand-hover"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        返回看板
      </Link>

      {/* 编辑器自带分组卡片，直接铺在页面上，两侧与返回链接对齐。 */}
      <div className="-mx-4 sm:-mx-5">
        <TaskDetailClient
          key={taskId}
          taskDetail={task}
          members={members}
          currentUserId={user.id}
          today={dateInTimezone(user.timezone)}
          readOnly={project.archivedAt !== null}
          isProjectOwner={project.role === "OWNER"}
          canDelete={task !== null && (project.role === "OWNER" || task.creator.id === user.id)}
        />
      </div>
    </div>
  );
}
