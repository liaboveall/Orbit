import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { TaskListQuerySchema } from "@/contracts";
import { dateInTimezone } from "@/lib/calendar";
import { getSessionUser } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getProject, listMembers } from "@/server/modules/project";
import { listProjectTasks, getTask } from "@/server/modules/task";
import { TaskListClient } from "@/features/tasks/real/task-list-client";
import { TaskFilters } from "@/features/tasks/real/task-filters";
import { TaskPanel } from "@/features/tasks/real/task-panel";
import { ProjectRefresh } from "@/features/tasks/real/project-refresh";
import { InlineError } from "@/components/ui";
export const metadata: Metadata = { title: "任务列表 · Orbit" };
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const raw = await searchParams;
  const user = await getSessionUser(await headers());
  if (!user)
    redirect(
      "/auth/login?returnTo=" +
        encodeURIComponent("/app/projects/" + id + "/tasks"),
    );
  const data = await (async () => {
    try {
      const project = await getProject(id, user.id);
      const { task: selection, ...filters } = raw;
      const parsed = TaskListQuerySchema.safeParse(filters);
      if (!parsed.success) return null;
      const [result, members, task] = await Promise.all([
        listProjectTasks(project.id, user.id, { ...parsed.data, limit: 50 }),
        listMembers(project.id, user.id),
        typeof selection === "string" ? getTask(selection, user.id) : null,
      ]);
      if (task && task.projectId !== project.id) notFound();
      const today = dateInTimezone(user.timezone);
      return { project, members, task, today, parsed, result };
    } catch (error) {
      if (error instanceof DomainError && error.code === "NOT_FOUND")
        notFound();
      throw error;
    }
  })();
  if (!data)
    return (
      <InlineError>筛选参数无效，请清除地址栏查询参数后重试。</InlineError>
    );
  const { project, members, task, today, parsed, result } = data;
  return (
    <>
      <ProjectRefresh />
      <TaskFilters projectId={project.id} members={members} />
      <TaskListClient
        project={project}
        initialTasks={result.tasks}
        nextCursor={result.nextCursor}
        hasMore={result.hasMore}
        today={today}
        userId={user.id}
        query={parsed.data}
      />
      {task && (
        <TaskPanel
          members={members}
          key={task.id}
          task={task}
          project={project}
          userId={user.id}
          today={today}
        />
      )}
    </>
  );
}
