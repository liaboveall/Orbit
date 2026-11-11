import type { Metadata } from "next";
import { InlineError } from "@/components/ui";
import { TaskListQuerySchema } from "@/contracts";
import { ProjectRefresh } from "@/features/tasks/real/project-refresh";
import { TaskListClient } from "@/features/tasks/real/task-list-client";
import { TaskPanel } from "@/features/tasks/real/task-panel";
import { dateInTimezone } from "@/lib/calendar";
import { DomainError } from "@/server/http/errors";
import { listMembers } from "@/server/modules/project";
import { findProjectTask, listProjectTasks } from "@/server/modules/task";
import { loadProject, orNotFound } from "../_data";

export const metadata: Metadata = { title: "任务列表 · Orbit" };
export const dynamic = "force-dynamic";

const invalidFilters = <InlineError>筛选参数无效，请清除地址栏查询参数后重试。</InlineError>;

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, project } = await loadProject((await params).id);
  const { task: selection, ...filters } = await searchParams;
  const query = TaskListQuerySchema.safeParse(filters);
  if (!query.success) return invalidFilters;

  let data;
  try {
    data = await orNotFound(
      Promise.all([
        listProjectTasks(project.id, user.id, { ...query.data, limit: 50 }),
        listMembers(project.id, user.id),
        typeof selection === "string" ? findProjectTask(selection, project.id, user.id) : null,
      ]),
    );
  } catch (error) {
    if (error instanceof DomainError && error.code === "VALIDATION_ERROR") return invalidFilters;
    throw error;
  }
  const [result, members, task] = data;
  const today = dateInTimezone(user.timezone);

  return (
    <>
      <ProjectRefresh />
      <TaskListClient
        project={project}
        members={members}
        initialTasks={result.tasks}
        nextCursor={result.nextCursor}
        today={today}
        userId={user.id}
        query={query.data}
      />
      {/* 所选任务已删除或不存在时仍渲染面板说明，页面其余部分保持可用。 */}
      {typeof selection === "string" && (
        <TaskPanel key={selection} task={task} project={project} members={members} userId={user.id} today={today} />
      )}
    </>
  );
}
