import type { Metadata } from "next";
import { ActivityFeed } from "@/features/activity/ActivityFeed";
import { listActivities } from "@/server/modules/activity";
import { loadProject, orNotFound } from "../_data";

export const metadata: Metadata = { title: "项目活动 · Orbit" };
export const dynamic = "force-dynamic";

/** 首屏条数，与 ActivityFeed 的「加载更多」一致。 */
const PAGE_SIZE = 30;

export default async function ProjectActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, project } = await loadProject((await params).id);
  const result = await orNotFound(listActivities({ projectId: project.id, actorId: user.id, limit: PAGE_SIZE }));
  return (
    <ActivityFeed
      projectId={project.id}
      initialActivities={result.activities}
      nextCursor={result.nextCursor}
      hasMore={result.hasMore}
    />
  );
}
