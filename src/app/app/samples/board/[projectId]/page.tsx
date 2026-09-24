import type { Metadata } from "next";
import { parseSampleState } from "@/features/shell/sample-state";
import { BoardView } from "@/features/board/board-view";

/**
 * /app/samples/board/[projectId] · M0 看板布局样例（分叉 1 迁移）。
 *
 * M3 分叉 1：原 fixture 看板从 /app/projects/[id]/board 迁到独立样例路由，
 * 侧栏 fixture 链接与 accessibility-and-layout 均指向此处；真实 /app/projects/[id]/board
 * 后续接真实 Server Component 数据（ORB-002 样例行为在此完整保留）。
 *
 * Server Component：解析路由参数 projectId 与查询参数 `?state=` / `?task=`。
 * `?task=<id>` 打开任务详情侧面板（关闭时由客户端移除该参数并保留其余查询）。
 * Next 16 中 params/searchParams 均为 Promise，需 await。
 */

export const metadata: Metadata = {
  title: "看板 · Orbit（M0 样例）",
};

type PageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ state?: string | string[]; task?: string | string[] }>;
};

function firstString(v: string | string[] | undefined): string | null {
  const value = Array.isArray(v) ? v[0] : v;
  return value && value.length > 0 ? value : null;
}

export default async function SamplesBoardPage({ params, searchParams }: PageProps) {
  const { projectId } = await params;
  const sp = await searchParams;
  return (
    <BoardView
      projectId={projectId}
      state={parseSampleState(sp.state)}
      openTaskId={firstString(sp.task)}
    />
  );
}
