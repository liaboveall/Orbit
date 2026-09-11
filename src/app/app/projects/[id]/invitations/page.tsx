import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { InvitationsList } from "@/features/invitations/InvitationsList";
import { loginPathWithReturnTo } from "@/lib/return-to";
import { getSessionUser } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getProject } from "@/server/modules/project";
import { listInvitations } from "@/server/modules/invitation/service";

/**
 * /app/projects/[id]/invitations —— 邀请管理（M4 / ORB-013）。
 *
 * Server Component 负责**权威数据读取**（与 board/tasks/trash 同范式）：
 *  1. `getSessionUser(await headers())` 取会话；未认证 → 带 returnTo 重定向登录页；
 *  2. `getProject` 判定成员关系（非成员/不存在 → notFound()，不泄露项目是否存在）；
 *  3. `listInvitations` 直调领域服务（与后端同一实现）读取邀请列表；
 *  4. InvitationDTO[] 为纯 JSON，直接作为 props 传给客户端 InvitationsList。
 *
 * 授权：查看、创建、撤销邀请均为 owner-only，由 `userIsOwner` 收敛入口，
 * 服务端 API 仍权威复核（前端隐藏不构成权限控制，docs/03 §5）。
 *
 * 缓存：读取 headers() 属动态渲染，另显式 force-dynamic，项目私有数据不进共享缓存。
 */

export const metadata: Metadata = { title: "邀请管理 · Orbit" };
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectInvitationsPage({ params }: PageProps) {
  const { id } = await params;
  const sessionUser = await getSessionUser(await headers());
  if (!sessionUser) {
    redirect(loginPathWithReturnTo(`/app/projects/${id}/invitations`));
  }

  let invitations;
  let isOwner;
  try {
    const [project, list] = await Promise.all([
      getProject(id, sessionUser.id),
      listInvitations(id, sessionUser.id),
    ]);
    invitations = list;
    isOwner = project.role === "OWNER";
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <InvitationsList
      projectId={id}
      userIsOwner={isOwner}
      initialInvitations={invitations}
    />
  );
}
