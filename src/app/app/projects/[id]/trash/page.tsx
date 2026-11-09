import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTimeCN } from "@/features/tasks/real/datetime";
import { TaskRestoreButton } from "@/features/tasks/real/task-restore-button";
import { requirePageUser } from "@/server/auth/page-session";
import { DomainError } from "@/server/http/errors";
import { getProject } from "@/server/modules/project";
import { listProjectTasks } from "@/server/modules/task";

/**
 * /app/projects/[id]/trash —— 项目回收站（M2 Phase 6：最小恢复信息）。
 *
 * Server Component 直出（无客户端列表组件）：回收站是低频页，首屏渲染已删除任务
 * （deleted=only，契约上限 100 条），唯一交互「恢复」由 TaskRestoreButton
 * 调 POST /api/v1/tasks/{id}/restore，成功后 `router.refresh()` 重读本页。
 *
 * 授权与任务列表页一致：`getProject` 成员判定（非成员/不存在 → notFound()），
 * `listProjectTasks(deleted:"only")` 内部再次 requireProjectMember。
 * 恢复入口按角色收敛（owner 或任务创建者），服务端仍权威判定 403。
 */

export const metadata: Metadata = { title: "回收站" };
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectTrashPage({ params }: PageProps) {
  const { id } = await params;
  const sessionUser = await requirePageUser();

  let project;
  let deletedTasks;
  try {
    [project, deletedTasks] = await Promise.all([
      getProject(id, sessionUser.id),
      // deleted=only：仅已软删除任务（服务端按 deletedAt 过滤，成员可见）。
      listProjectTasks(id, sessionUser.id, { deleted: "only", limit: 100 }),
    ]);
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const tasksPath = `/app/projects/${project.id}/tasks`;
  const isOwner = project.role === "OWNER";

  return (
    <div className="w-full max-w-4xl">
      <PageHeader
        eyebrow={project.name}
        title="回收站"
        description={`已删除的任务保留在此，可恢复回任务列表（共 ${deletedTasks.tasks.length}${deletedTasks.hasMore ? "+" : ""} 条）。`}
        actions={
          <Link href={tasksPath} className={buttonVariants({ variant: "secondary" })}>
            返回任务列表
          </Link>
        }
      />

      {deletedTasks.tasks.length === 0 ? (
        <EmptyState
          icon={<Trash2 className="h-6 w-6" />}
          title="回收站为空"
          description="删除的任务会移入这里，恢复前不会从项目中消失。"
          action={
            <Link href={tasksPath} className={buttonVariants({ size: "lg" })}>
              返回任务列表
            </Link>
          }
        />
      ) : (
        <ul className="glass-card divide-y divide-line overflow-hidden rounded-card">
          {deletedTasks.tasks.map((task) => (
            <li
              key={task.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
            >
              <span className="shrink-0 text-caption tabular-nums text-foreground-muted">
                {task.identifier}
              </span>
              <span className="min-w-0 flex-1 truncate text-label font-medium text-foreground" title={task.title}>
                {task.title}
              </span>
              <span className="shrink-0 text-caption text-foreground-muted">
                删除于{" "}
                <time dateTime={task.deletedAt ?? undefined}>
                  {task.deletedAt ? formatDateTimeCN(task.deletedAt, sessionUser.timezone) : "未知时间"}
                </time>
              </span>
              {/* 401 硬跳转在客户端组件内完成：仅传可序列化的 returnTo（跨 RSC 边界不可传函数）。 */}
              <TaskRestoreButton
                task={task}
                canRestore={isOwner || task.creator.id === sessionUser.id}
                returnTo={`/app/projects/${project.id}/trash`}
              />
            </li>
          ))}
        </ul>
      )}

      {deletedTasks.hasMore ? (
        <p className="mt-4 text-caption text-foreground-muted">
          仅显示最近删除的 {deletedTasks.tasks.length} 条（更多恢复入口属后续里程碑）。
        </p>
      ) : null}
    </div>
  );
}
