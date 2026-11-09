import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActivityFeed } from "@/features/activity/ActivityFeed";
import { requirePageUser } from "@/server/auth/page-session";
import { DomainError } from "@/server/http/errors";
import { listActivities } from "@/server/modules/activity";
import { getProject } from "@/server/modules/project";

/**
 * /app/projects/[id]/activity —— 项目活动（M4 / ORB-011）。
 *
 * Server Component 权威读取（与 board/tasks 同范式）：
 *  1. requirePageUser → 未认证重定向登录页、读取超额跳转限流说明页；
 *  2. getProject 判定成员关系（非成员/不存在 → notFound()）；
 *  3. listActivities 直调领域服务（与 GET /api/v1/projects/{id}/activity?limit=30 同一实现，
 *     成员授权 + keyset 游标分页 + createdAt DESC）；
 *  4. ActivityDTO[] 纯 JSON 传给客户端 ActivityFeed（「加载更多」交互在其中）。
 *
 * 缓存：读取 headers() 属动态渲染，另显式 force-dynamic。
 */

export const metadata: Metadata = { title: "项目活动 · Orbit" };
export const dynamic = "force-dynamic";

/** 首屏页大小（与 ActivityFeed 的「加载更多」一致，契约上限 100）。 */
const PAGE_SIZE = 30;

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectActivityPage({ params }: PageProps) {
  const { id } = await params;
  const sessionUser = await requirePageUser();

  let result;
  let projectName;
  try {
    // getProject 先判定成员关系（非成员/不存在 → NOT_FOUND → notFound()）。
    projectName = (await getProject(id, sessionUser.id)).name;
    result = await listActivities({
      projectId: id,
      actorId: sessionUser.id,
      limit: PAGE_SIZE,
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <ActivityFeed
      projectId={id}
      projectName={projectName}
      initialActivities={result.activities}
      nextCursor={result.nextCursor}
      hasMore={result.hasMore}
    />
  );
}
