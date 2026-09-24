import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BoardQuerySchema } from "@/contracts";
import { dateInTimezone } from "@/lib/calendar";
import { requirePageUser } from "@/server/auth/page-session";
import { DomainError } from "@/server/http/errors";
import { getProject, listMembers } from "@/server/modules/project";
import { findProjectTask } from "@/server/modules/task";
import { getBoard } from "@/server/modules/task/board";
import { TaskFilters } from "@/features/tasks/real/task-filters";
import { TaskPanel } from "@/features/tasks/real/task-panel";
import { RealBoard } from "@/features/board/real-board";
import { InlineError } from "@/components/ui";
export const metadata: Metadata = { title: "看板 · Orbit" };
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
  const user = await requirePageUser();
  const data = await (async () => {
    try {
      const project = await getProject(id, user.id);
      const { task: selection, ...filters } = raw;
      const parsed = BoardQuerySchema.safeParse(filters);
      if (!parsed.success) return null;
      const [board, members, task] = await Promise.all([
        getBoard(project.id, user.id, parsed.data),
        listMembers(project.id, user.id),
        typeof selection === "string" ? findProjectTask(selection, project.id, user.id) : null,
      ]);
      const today = dateInTimezone(user.timezone);
      return { project, members, task, selection, today, parsed, board };
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
  const { project, members, task, selection, today, parsed, board } = data;
  return (
    <>
      <TaskFilters projectId={project.id} members={members} board />
      <RealBoard
        key={`${user.id}:${project.id}`}
        initial={board}
        project={project}
        query={parsed.data}
        today={today}
      />
      {/* 所选任务被删除/不存在时仍渲染面板说明，页面其余部分保持可用（不整页 404）。 */}
      {typeof selection === "string" && (
        <TaskPanel
          members={members}
          key={selection}
          task={task}
          project={project}
          userId={user.id}
          today={today}
        />
      )}
    </>
  );
}
