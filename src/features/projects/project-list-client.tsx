"use client";

import { Archive, ArchiveRestore, ArrowUpRight, FolderPlus, LayoutGrid, ListChecks, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiClientError,
  ProjectSchema,
  createApiClient,
  type ListVisibilityFilter,
  type ProjectDTO,
} from "@/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineError } from "@/components/ui/inline-error";
import { LinkLabel } from "@/components/ui/link-label";
import { PageHeader } from "@/components/ui/page-header";
import { Segments } from "@/components/ui/segments";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { loginPathWithReturnTo } from "@/lib/return-to";
import { projectColorAria } from "@/lib/project-color";
import { ProjectCreateDialog } from "./project-create-form";
import { ProjectGlyph } from "./project-glyph";

/**
 * 项目列表客户端（M2 Phase 6，`/app/projects`）。
 *
 * 数据流（沿用 settings-form 范式，不引入客户端缓存库）：
 *  - 首屏数据由 Server Component 用领域服务 listProjects 取得后经 props 传入
 *    （ProjectDTO 纯 JSON，序列化边界安全）；
 *  - 「加载更多」用契约层 `api.getList("/projects", ProjectSchema, { cursor, archived })`
 *    取下一页并追加（keyset 游标来自上一页 PageMeta），沿用当前 tab 的 archived 过滤，
 *    否则加载更多会把另一个 tab 的数据接到当前列表；
 *  - 「未归档 / 已归档」tab 通过 `router.push` 改写 URL `?archived=`，触发 Server
 *    Component 用新过滤重新取数（A08 审查修复：归档项目离开页面后可从列表找回并进入
 *    恢复入口，不必只靠已知 URL 直达设置页）；
 *  - 创建/恢复成功后 `await router.refresh()`：Server Component 重读列表并以新 props
 *    重渲染本页 —— props 是唯一数据真源，不再用 useState 镜像（镜像会与 refresh
 *    后的新 props 脱节，导致同页 UI 停在旧值）。
 *
 * 交互约束（docs/02）：卡片整体是可聚焦 button（键盘 Enter 进入任务列表），
 * 空态解释价值并提供「创建第一个项目」的下一步；错误用 InlineError 驻留。
 * 边界：features 层，不导入 @/server / @/generated。
 */

const api = createApiClient();

const PROJECTS_PATH = "/app/projects";
/** 与 page.tsx 首屏一致的页大小（契约 limit 上限 100）。 */
const PAGE_SIZE = 30;

export type ProjectListClientProps = {
  initialProjects: ProjectDTO[];
  nextCursor: string | null;
  hasMore: boolean;
  /** 当前 tab 对应的归档过滤（由 page.tsx 解析 URL `?archived=` 传入）。 */
  archived: ListVisibilityFilter;
};

export function ProjectListClient({
  initialProjects,
  nextCursor: initialCursor,
  hasMore: initialHasMore,
  archived,
}: ProjectListClientProps) {
  const router = useRouter();

  // 数据真源是 Server Component 传入的 props：写操作后 `await router.refresh()` 会带来
  // 新的 initialProjects 引用，本组件据此直接重渲染。**不**用 useState 镜像 props ——
  // 镜像不会随 refresh 后的新 props 重新初始化，会让列表停在旧值。
  //
  // 「加载更多」是纯客户端分页追加：只把额外拉取到的下一页片段存进 extra* state，
  // 渲染时以 props 首屏为基拼接；一旦 base props 变化（refresh 后或切换 tab 后），在
  // 渲染阶段同步丢弃追加片段，避免与新首屏重复（React「渲染期间依据 props 调整 state」范式）。
  const [extraProjects, setExtraProjects] = useState<ProjectDTO[]>([]);
  const [extraCursor, setExtraCursor] = useState<string | null>(null);
  const [extraHasMore, setExtraHasMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  // 代次（generation）：绑定 project 列表的每一次权威刷新（新 initialProjects 引用，
  // 无论来自 refresh 后的 server component 重取、tab 切换改写 URL 触发的重取，还是
  // 组件卸载）。「加载更多」发起时把当前代次拍进闭包，响应落地时与 ref 最新值比对，
  // 不相等即整体丢弃（不更新 projects/cursor/hasMore/error/pending 中的任何一项）——
  // 用 ref 而非 state，因为它只是「本次响应是否仍有效」的判据，本身不需要触发渲染；
  // dedupe-by-id 不足以防护，因为旧响应可能来自另一个 archived 筛选下的完全不同数据。
  const generationRef = useRef(0);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
    };
  }, []);

  const [prevInitialProjects, setPrevInitialProjects] = useState(initialProjects);
  if (prevInitialProjects !== initialProjects) {
    setPrevInitialProjects(initialProjects);
    setExtraProjects([]);
    setExtraCursor(null);
    setExtraHasMore(false);
    // 新首屏到达（refresh 或 tab 切换带来的新 initialProjects 引用）= 新代次开始。
    // 一个仍在飞行、绑定着旧代次的 handleLoadMore 响应落地时会发现代次已不匹配而
    // 整体丢弃、且不会解除 pending（避免与本次重置产生竞争性的二次 setState）——
    // 因此这里必须主动清零 loadingMore，否则新代次会永久停在「正在加载…」，因为
    // 已经没有任何代码路径会再把它设回 false。
    setLoadingMore(false);
  }

  // 代次前移不能写在渲染体内（react-hooks/refs 禁止渲染期读写 ref.current），移入
  // effect：initialProjects 引用变化（refresh / tab 切换）→ 上面的渲染期块先重置分页
  // state → 提交 → 本 effect 运行 generation++。此后任何绑定旧代次、仍在飞行的
  // handleLoadMore 响应落地时都会发现 generationRef.current 已前进而被整体丢弃。
  useEffect(() => {
    generationRef.current += 1;
  }, [initialProjects]);

  const projects =
    extraProjects.length > 0 ? [...initialProjects, ...extraProjects] : initialProjects;
  const cursor = extraProjects.length > 0 ? extraCursor : initialCursor;
  const hasMore = extraProjects.length > 0 ? extraHasMore : initialHasMore;

  /** 401（refresh 后会话恰失效等）→ 硬跳转登录页，让 proxy/服务端重估认证态。 */
  const goToLogin = useCallback(() => {
    window.location.assign(loginPathWithReturnTo(PROJECTS_PATH));
  }, []);

  async function handleLoadMore(): Promise<void> {
    if (loadingMore || !cursor) return;
    const requestGeneration = generationRef.current;
    setLoadingMore(true);
    setListError(null);
    try {
      const result = await api.getList("/projects", ProjectSchema, {
        query: { cursor, limit: PAGE_SIZE, archived },
      });
      if (generationRef.current !== requestGeneration) return;
      if (result.ok) {
        setExtraProjects((prev) => [...prev, ...result.data]);
        setExtraCursor(result.meta.nextCursor);
        setExtraHasMore(result.meta.hasMore);
        return;
      }
      if (result.status === 401) {
        goToLogin();
        return;
      }
      setListError(result.error.message);
    } catch (error) {
      if (generationRef.current !== requestGeneration) return;
      setListError(
        error instanceof ApiClientError
          ? "无法连接服务器，请检查网络后重试。"
          : "加载项目列表失败，请稍后重试。",
      );
    } finally {
      if (generationRef.current === requestGeneration) setLoadingMore(false);
    }
  }

  async function handleRestore(project: ProjectDTO): Promise<void> {
    if (restoringId) return;
    setRestoringId(project.id);
    setListError(null);
    try {
      const result = await api.patch(`/projects/${project.id}`, ProjectSchema, {
        expectedVersion: project.version,
        archived: false,
      });
      if (result.ok) {
        await router.refresh();
        return;
      }
      if (result.status === 401) {
        goToLogin();
        return;
      }
      setListError(result.error.message);
    } catch (error) {
      setListError(
        error instanceof ApiClientError
          ? "无法连接服务器，请检查网络后重试。"
          : "恢复项目失败，请稍后重试。",
      );
    } finally {
      setRestoringId(null);
    }
  }

  function switchTab(next: ListVisibilityFilter): void {
    if (next === archived) return;
    setListError(null);
    router.push(next === "only" ? `${PROJECTS_PATH}?archived=only` : PROJECTS_PATH);
  }

  const tabClass = (active: boolean) =>
    cn(
      "inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-label font-medium outline-none transition-colors duration-200",
      active ? "text-foreground" : "text-foreground-secondary hover:text-foreground",
    );
  const openCreate = () => {
    setListError(null);
    setCreating(true);
  };

  return (
    <div className="w-full animate-rise md:pt-3">
      <PageHeader
        title="全部项目"
        description={`${archived === "only" ? "已归档的项目（只读）" : "你拥有或参与的项目"}，共 ${projects.length}${hasMore ? "+" : ""} 个`}
        actions={
          <>
            <Segments
              role="tablist"
              aria-label="项目归档筛选"
              activeKey={archived}
              className="inline-flex rounded-full bg-surface-sunken p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={archived === "exclude"}
                data-active={archived === "exclude" || undefined}
                onClick={() => switchTab("exclude")}
                className={tabClass(archived === "exclude")}
              >
                未归档
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={archived === "only"}
                data-active={archived === "only" || undefined}
                onClick={() => switchTab("only")}
                className={tabClass(archived === "only")}
              >
                <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                已归档
              </button>
            </Segments>
            {archived === "exclude" && projects.length > 0 ? (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                新建项目
              </Button>
            ) : null}
          </>
        }
      />

      {archived === "exclude" ? (
        <ProjectCreateDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={async () => {
            setCreating(false);
            await router.refresh();
          }}
          onUnauthorized={goToLogin}
        />
      ) : null}

      <InlineError className="mb-4">{listError}</InlineError>

      {projects.length === 0 ? (
        archived === "only" ? (
          <EmptyState
            icon={<Archive className="h-6 w-6" />}
            title="没有已归档的项目"
            description="归档项目会出现在这里，可随时恢复为可编辑状态。"
          />
        ) : (
          <EmptyState
            icon={<LayoutGrid className="h-6 w-6" />}
            title="还没有项目"
            description="项目是任务与看板的家。创建第一个项目，就能开始分派任务、追踪进度。"
            action={
              <Button onClick={openCreate}>
                <FolderPlus className="h-4 w-4" aria-hidden="true" />
                创建第一个项目
              </Button>
            }
          />
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 xl:gap-4">
          {projects.map((project) => (
            <li key={project.id}>
              <ProjectCard
                project={project}
                showRestore={archived === "only"}
                restoring={restoringId === project.id}
                onRestore={() => {
                  void handleRestore(project);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {hasMore ? (
        <div className="mt-6 flex justify-center">
          <Button
            variant="secondary"
            disabled={loadingMore}
            aria-busy={loadingMore || undefined}
            onClick={() => {
              void handleLoadMore();
            }}
          >
            {loadingMore ? <Spinner /> : null}
            <span>{loadingMore ? "正在加载…" : "加载更多"}</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** 项目卡片：标题是覆盖整卡的链接，恢复按钮叠在其上，避免嵌套交互元素。 */
function ProjectCard({
  project,
  showRestore,
  restoring,
  onRestore,
}: {
  project: ProjectDTO;
  showRestore: boolean;
  restoring: boolean;
  onRestore: () => void;
}) {
  return (
    <article className="surface-card lift group relative flex h-full min-h-44 flex-col rounded-card p-5 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring">
      <div className="flex items-start justify-between gap-3">
        <ProjectGlyph name={project.name} color={project.color} size="lg" />
        {project.archivedAt !== null ? (
          <Badge tone="warning" icon={<Archive className="h-3 w-3" />}>
            已归档
          </Badge>
        ) : (
          <ArrowUpRight
            className="h-4 w-4 text-foreground-muted opacity-0 transition-[opacity,transform] duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100"
            aria-hidden="true"
          />
        )}
      </div>

      <h2 className="mt-4 truncate text-title font-semibold tracking-[-0.01em] text-foreground">
        <Link
          href={`/app/projects/${project.id}/board`}
          className="outline-none after:absolute after:inset-0 after:rounded-card after:content-['']"
        >
          <LinkLabel>{project.name}</LinkLabel>
        </Link>
      </h2>
      <p className="mt-0.5 text-caption tabular-nums text-foreground-muted">
        {project.key} · {project.role === "OWNER" ? "所有者" : "成员"}
        <span className="sr-only">，{projectColorAria(project.color)}</span>
      </p>

      {project.description.trim().length > 0 ? (
        <p className="mt-2.5 line-clamp-2 text-label leading-relaxed text-foreground-secondary">
          {project.description}
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-4 text-caption text-foreground-muted">
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          {project.memberCount} 名成员
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
          {project.openTaskCount} 个未完成任务
        </span>
        {showRestore && project.role === "OWNER" ? (
          <Button
            variant="secondary"
            size="sm"
            className="relative z-10 ml-auto"
            disabled={restoring}
            aria-busy={restoring || undefined}
            onClick={onRestore}
          >
            {restoring ? <Spinner /> : <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />}
            <span>{restoring ? "正在恢复…" : "恢复项目"}</span>
          </Button>
        ) : null}
      </div>
    </article>
  );
}
