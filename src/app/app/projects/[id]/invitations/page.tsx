import type { Metadata } from "next";
import { InvitationsList } from "@/features/invitations/InvitationsList";
import { listInvitations } from "@/server/modules/invitation/service";
import { loadProject, orNotFound } from "../_data";

/**
 * 邀请管理。查看、创建和撤销邀请都只给项目所有者：页面只为所有者读取邀请列表，
 * API 仍会再次校验，前端隐藏入口不算权限控制。
 */

export const metadata: Metadata = { title: "邀请管理 · Orbit" };
export const dynamic = "force-dynamic";

export default async function ProjectInvitationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, project } = await loadProject((await params).id);
  const isOwner = project.role === "OWNER";
  const invitations = isOwner ? await orNotFound(listInvitations(project.id, user.id)) : [];
  return <InvitationsList projectId={project.id} userIsOwner={isOwner} initialInvitations={invitations} />;
}
