import type { Metadata } from "next";
import { MembersList } from "@/features/members/MembersList";
import { listMembers } from "@/server/modules/project";
import { loadProject, orNotFound } from "../_data";

export const metadata: Metadata = { title: "项目成员 · Orbit" };
export const dynamic = "force-dynamic";

export default async function ProjectMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, project } = await loadProject((await params).id);
  const members = await orNotFound(listMembers(project.id, user.id));
  return (
    <MembersList
      projectId={project.id}
      currentUserId={user.id}
      isOwner={project.role === "OWNER"}
      members={members}
    />
  );
}
