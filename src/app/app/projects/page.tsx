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
 *     `archived` 过滤由 URL `?archived=only` 驱动（A08 审查修复：归档项目离开页面后
 *     必须能从列表找回并进入恢复入口，不能只靠已知 URL 直达设置页）、keyset 分页、
 *     出库前 ProjectSchema 复校 —— 不在页面里重写查询，保证页面与 API 永远返回
 *     同一份契约 DTO；
 *  3. ProjectDTO 已是纯 JSON（ISO 字符串日期、无 BigInt/Date），可直接作为
 *     props 传给客户端组件（Server → Client 序列化边界安全）。
 *
 * 交互（创建项目 / 加载更多 / 切换归档 tab）由 ProjectListClient 走契约层
 * createApiClient 调 /api/v1/projects，成功后 `router.refresh()` 让本页重读最新数据；
 * 切换 tab 通过 `router.push` 改写 `?archived=` 查询参数，与本页首屏过滤保持一致。
 *
 * 缓存：读取 headers() 属动态渲染，另显式 force-dynamic，项目私有数据不进共享缓存。
 */

export const metadata: Metadata = { title: "全部项目" };
export const dynamic = "force-dynamic";

const PROJECTS_PATH = "/app/projects";

/** 首屏页大小（契约上限 100；活跃项目配额仅 10，超出主要是已归档项目）。 */
const PAGE_SIZE = 30;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProjectsPage({ searchParams }: PageProps) {
  const sessionUser = await getSessionUser(await headers());
  if (!sessionUser) redirect(loginPathWithReturnTo(PROJECTS_PATH));

  const params = await searchParams;
  const rawArchived = Array.isArray(params.archived) ? params.archived[0] : params.archived;
  const archived = rawArchived === "only" ? "only" : "exclude";

  // 与 GET /projects?limit=30&archived= 同一服务：scope=all（拥有或参与）。
  const result = await listProjects(sessionUser.id, { limit: PAGE_SIZE, archived });

  return (
    <ProjectListClient
      initialProjects={result.projects}
      nextCursor={result.nextCursor}
      hasMore={result.hasMore}
      archived={archived}
    />
  );
}
