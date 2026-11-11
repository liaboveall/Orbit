import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/page-header";
import { formatDateTimeCN } from "@/features/tasks/real/datetime";
import { TaskRestoreButton } from "@/features/tasks/real/task-restore-button";
import { listProjectTasks } from "@/server/modules/task";
import { loadProject, orNotFound } from "../_data";

/**
 * 项目回收站：只显示已删除任务的摘要，唯一的操作是恢复。
 * 恢复入口只给项目所有者和任务创建者，服务端仍会校验。
 */

export const metadata: Metadata = { title: "回收站" };
export const dynamic = "force-dynamic";

export default async function ProjectTrashPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, project } = await loadProject((await params).id);
  const deleted = await orNotFound(listProjectTasks(project.id, user.id, { deleted: "only", limit: 100 }));
  const tasksPath = `/app/projects/${project.id}/tasks`;
  const isOwner = project.role === "OWNER";

  return (
    <div className="mx-auto w-full max-w-3xl">
      <SectionHeader
        title="回收站"
        description={`已删除的任务保留在此，可恢复回任务列表（共 ${deleted.tasks.length}${deleted.hasMore ? "+" : ""} 条）。`}
      />

      {deleted.tasks.length === 0 ? (
        <EmptyState
          icon={<Trash2 className="h-6 w-6" />}
          title="回收站为空"
          description="删除的任务会移入这里，恢复前不会从项目中消失。"
          action={
            <Link href={tasksPath} className={buttonVariants({ variant: "secondary" })}>
              返回任务列表
            </Link>
          }
        />
      ) : (
        <ul className="surface-card divide-y divide-line overflow-hidden rounded-card">
          {deleted.tasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 pl-5 pr-4">
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate text-label font-medium text-foreground" title={task.title}>
                  {task.title}
                </p>
                <p className="mt-0.5 text-caption text-foreground-muted">
                  <span className="tabular-nums">{task.identifier}</span>
                  <span aria-hidden="true"> · </span>
                  删除于{" "}
                  <time dateTime={task.deletedAt ?? undefined}>
                    {task.deletedAt ? formatDateTimeCN(task.deletedAt, user.timezone) : "未知时间"}
                  </time>
                </p>
              </div>
              {/* 401 的整页跳转在客户端组件里完成，这里只传可序列化的 returnTo。 */}
              <TaskRestoreButton
                task={task}
                canRestore={isOwner || task.creator.id === user.id}
                returnTo={`/app/projects/${project.id}/trash`}
              />
            </li>
          ))}
        </ul>
      )}

      {deleted.hasMore ? (
        <p className="mt-4 px-1 text-caption text-foreground-muted">仅显示最近删除的 {deleted.tasks.length} 条。</p>
      ) : null}
    </div>
  );
}
