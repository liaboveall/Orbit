import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ProjectListClient } from "@/features/projects/project-list-client";
import { loginPathWithReturnTo } from "@/lib/return-to";
import { getSessionUser } from "@/server/auth/session";
import { listProjects } from "@/server/modules/project";

/**
 * /app/projects —— 项目列表（M2 Phase 6：首个真实数据列表页）。
 *
 * 服务端组件负责**权威数据读取**（与 /app/settings 同范式）：
 *  1. `getSessionUser(await headers())` 取会话；未认证 → 带 returnTo 重定向登录页
 *     （proxy + app/layout 已双层保护，这里是防御性第三道）；
 *  2. 复用领域服务 `listProjects`（与 GET /api/v1/projects 同一实现）：成员关系过滤、
 *     默认排除已归档、keyset 分页、出库前 ProjectSchema 复校 —— 不在页面里重写查询，
 *     保证页面与 API 永远返回同一份契约 DTO；
 *  3. ProjectDTO 已是纯 JSON（ISO 字符串日期、无 BigInt/Date），可直接作为
 *     props 传给客户端组件（Server → Client 序列化边界安全）。
 *
 * 交互（创建项目 / 加载更多）由 ProjectListClient 走契约层 createApiClient
 * 调 /api/v1/projects，成功后 `router.refresh()` 让本页重读最新数据。
 *
 * 缓存：读取 headers() 属动态渲染，另显式 force-dynamic，项目私有数据不进共享缓存。
 */

export const metadata: Metadata = { title: "全部项目" };
export const dynamic = "force-dynamic";

const PROJECTS_PATH = "/app/projects";

/** 首屏页大小（契约上限 100；活跃项目配额仅 10，超出主要是已归档项目）。 */
const PAGE_SIZE = 30;

export default async function ProjectsPage() {
  const sessionUser = await getSessionUser(await headers());
  if (!sessionUser) redirect(loginPathWithReturnTo(PROJECTS_PATH));

  // 与 GET /projects?limit=30 同一服务：scope=all（拥有或参与）、archived=exclude。
  const result = await listProjects(sessionUser.id, { limit: PAGE_SIZE });

  return (
    <ProjectListClient
      initialProjects={result.projects}
      nextCursor={result.nextCursor}
      hasMore={result.hasMore}
    />
  );
}
