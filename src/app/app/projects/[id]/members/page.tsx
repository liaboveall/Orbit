import type { Metadata } from "next";
import { MembersList } from "@/features/members/MembersList";
import { listMembers } from "@/server/modules/project";
import { loadProject, orNotFound } from "../_data";
import { PageTransition } from "@/components/ui/transitions";
import { LiveScope } from "@/features/shell/live";

export const metadata: Metadata = { title: "项目成员 · Orbit" };
export const dynamic = "force-dynamic";

export default async function ProjectMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, project, seed } = await loadProject((await params).id);
  const members = await orNotFound(listMembers(project.id, user.id));
  return (
    <PageTransition variant="swap">
      <div>
        <LiveScope project={project.id} seed={seed} />
        <MembersList
          projectId={project.id}
          currentUserId={user.id}
          isOwner={project.role === "OWNER"}
          members={members}
        />
      </div>
    </PageTransition>
  );
}
