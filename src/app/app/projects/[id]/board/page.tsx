import type { Metadata } from "next";
import { InlineError } from "@/components/ui";
import { BoardQuerySchema } from "@/contracts";
import { RealBoard } from "@/features/board/real-board";
import { TaskPanel } from "@/features/tasks/real/task-panel";
import { dateInTimezone } from "@/lib/calendar";
import { listMembers } from "@/server/modules/project";
import { findProjectTask } from "@/server/modules/task";
import { getBoard } from "@/server/modules/task/board";
import { loadProject, orNotFound } from "../_data";

export const metadata: Metadata = { title: "看板 · Orbit" };
export const dynamic = "force-dynamic";

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, project } = await loadProject((await params).id);
  const { task: selection, ...filters } = await searchParams;
  const query = BoardQuerySchema.safeParse(filters);
  if (!query.success) return <InlineError>筛选参数无效，请清除地址栏查询参数后重试。</InlineError>;

  const [board, members, task] = await orNotFound(
    Promise.all([
      getBoard(project.id, user.id, query.data),
      listMembers(project.id, user.id),
      typeof selection === "string" ? findProjectTask(selection, project.id, user.id) : null,
    ]),
  );
  const today = dateInTimezone(user.timezone);

  return (
    <>
      <RealBoard
        key={`${user.id}:${project.id}`}
        initial={board}
        project={project}
        members={members}
        query={query.data}
        today={today}
      />
      {/* 所选任务已删除或不存在时仍渲染面板说明，页面其余部分保持可用。 */}
      {typeof selection === "string" && (
        <TaskPanel key={selection} task={task} project={project} members={members} userId={user.id} today={today} />
      )}
    </>
  );
}
