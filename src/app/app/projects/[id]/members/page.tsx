import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MembersList } from "@/features/members/MembersList";
import { requirePageUser } from "@/server/auth/page-session";
import { DomainError } from "@/server/http/errors";
import { getProject, listMembers } from "@/server/modules/project";

/**
 * /app/projects/[id]/members —— 项目成员（M4 / ORB-014）。
 *
 * Server Component 权威读取（与 board/tasks/trash 同范式）：
 *  1. requirePageUser → 未认证重定向登录页、读取超额跳转限流说明页；
 *  2. getProject 判定成员关系（非成员/不存在 → notFound()）并取得 role；
 *  3. listMembers 直调领域服务（与 GET /api/v1/projects/{id}/members 同一实现）；
 *  4. MemberDTO[] 纯 JSON 传给客户端 MembersList（移除/退出交互在其中）。
 *
 * 缓存：读取 headers() 属动态渲染，另显式 force-dynamic。
 */

export const metadata: Metadata = { title: "项目成员 · Orbit" };
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectMembersPage({ params }: PageProps) {
  const { id } = await params;
  const sessionUser = await requirePageUser();

  let members;
  let isOwner;
  try {
    const [project, list] = await Promise.all([
      getProject(id, sessionUser.id),
      listMembers(id, sessionUser.id),
    ]);
    members = list;
    isOwner = project.role === "OWNER";
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <MembersList
      projectId={id}
      currentUserId={sessionUser.id}
      isOwner={isOwner}
      members={members}
    />
  );
}
