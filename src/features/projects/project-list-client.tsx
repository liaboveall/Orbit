"use client";

import { Archive, FolderPlus, LayoutGrid, ListChecks, Plus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import {
  ApiClientError,
  ProjectSchema,
  createApiClient,
  type ProjectDTO,
} from "@/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineError } from "@/components/ui/inline-error";
import { Spinner } from "@/features/auth/auth-form";
import { cn } from "@/lib/cn";
import { loginPathWithReturnTo } from "@/lib/return-to";
import { PROJECT_COLOR_DOT, PROJECT_COLOR_LABEL, projectColorAria } from "@/lib/project-color";
import { ProjectCreateForm } from "./project-create-form";

/**
 * 项目列表客户端（M2 Phase 6，`/app/projects`）。
 *
 * 数据流（沿用 settings-form 范式，不引入客户端缓存库）：
 *  - 首屏数据由 Server Component 用领域服务 listProjects 取得后经 props 传入
 *    （ProjectDTO 纯 JSON，序列化边界安全）；
 *  - 「加载更多」用契约层 `api.getList("/projects", ProjectSchema, { cursor })`
 *    取下一页并追加（keyset 游标来自上一页 PageMeta）；
 *  - 创建成功后 `await router.refresh()`：Server Component 重读列表并以新 props
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
};

export function ProjectListClient({
  initialProjects,
  nextCursor: initialCursor,
  hasMore: initialHasMore,
}: ProjectListClientProps) {
  const router = useRouter();

  // 数据真源是 Server Component 传入的 props：写操作后 `await router.refresh()` 会带来
  // 新的 initialProjects 引用，本组件据此直接重渲染。**不**用 useState 镜像 props ——
  // 镜像不会随 refresh 后的新 props 重新初始化，会让列表停在旧值。
  //
  // 「加载更多」是纯客户端分页追加：只把额外拉取到的下一页片段存进 extra* state，
  // 渲染时以 props 首屏为基拼接；一旦 base props 变化（refresh 后），在渲染阶段同步
  // 丢弃追加片段，避免与新首屏重复（React「渲染期间依据 props 调整 state」范式）。
  const [extraProjects, setExtraProjects] = useState<ProjectDTO[]>([]);
  const [extraCursor, setExtraCursor] = useState<string | null>(null);
  const [extraHasMore, setExtraHasMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [prevInitialProjects, setPrevInitialProjects] = useState(initialProjects);
  if (prevInitialProjects !== initialProjects) {
    setPrevInitialProjects(initialProjects);
    setExtraProjects([]);
    setExtraCursor(null);
    setExtraHasMore(false);
  }

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
    setLoadingMore(true);
    setListError(null);
    try {
      const result = await api.getList("/projects", ProjectSchema, {
        query: { cursor, limit: PAGE_SIZE },
      });
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
      setListError(
        error instanceof ApiClientError
          ? "无法连接服务器，请检查网络后重试。"
          : "加载项目列表失败，请稍后重试。",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-caption uppercase tracking-[0.18em] text-foreground-muted">
            projects · /api/v1/projects
          </p>
          <h1 className="mt-1 text-page font-semibold tracking-tight text-foreground">
            全部项目
          </h1>
          <p className="mt-1.5 text-label text-foreground-secondary">
            你拥有或参与的项目（未归档）· 共 {projects.length} 个
            {hasMore ? "+" : ""}
          </p>
        </div>
        {projects.length > 0 ? (
          <Button
            type="button"
            onClick={() => {
              setListError(null);
              setCreating((prev) => !prev);
            }}
            aria-expanded={creating}
            aria-controls="project-create-form"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>{creating ? "收起表单" : "新建项目"}</span>
          </Button>
        ) : null}
      </header>

      {/* 创建表单：展开在页头之下（空态按钮同样触发） */}
      {creating ? (
        <div id="project-create-form" className="mb-6">
          <ProjectCreateForm
            onCreated={async () => {
              // toast（「项目已创建」）由表单在成功分支自行发出（含项目名）。
              setCreating(false);
              // await：等新 props 流入后再由表单解除 loading，避免用旧数据再次提交。
              await router.refresh();
            }}
            onCancelled={() => setCreating(false)}
            onUnauthorized={goToLogin}
          />
        </div>
      ) : null}

      <InlineError className="mb-4">{listError}</InlineError>

      {projects.length === 0 && !creating ? (
        <EmptyState
          icon={<LayoutGrid className="h-6 w-6" />}
          title="还没有项目"
          description="项目是任务与看板的家。创建第一个项目，就能开始分派任务、追踪进度。"
          action={
            <Button
              type="button"
              size="lg"
              onClick={() => {
                setListError(null);
                setCreating(true);
              }}
            >
              <FolderPlus className="h-4 w-4" aria-hidden="true" />
              创建第一个项目
            </Button>
          }
        />
      ) : null}

      {projects.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
      ) : null}

      {hasMore ? (
        <div className="mt-6 flex justify-center">
          <Button
            type="button"
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

/**
 * 项目卡片：整卡为单个 button（无嵌套交互元素），点击进入该项目的任务列表。
 * 展示 name / key（mono Badge）/ 标记色圆点（附文本，不单靠颜色）/ 角色 /
 * 成员数 / 未完成任务数；已归档项目（服务默认排除，防御性支持）加「已归档」标识。
 */
function ProjectCard({ project }: { project: ProjectDTO }) {
  const router = useRouter();
  const archived = project.archivedAt !== null;

  return (
    <button
      type="button"
      onClick={() => {
        router.push(`/app/projects/${project.id}/tasks`);
      }}
      className={cn(
        "flex h-full w-full flex-col gap-3 rounded-card border border-line bg-surface p-4 text-left",
        "shadow-popover outline-none transition-colors duration-150 ease-standard",
        "hover:border-line-strong hover:bg-surface-sunken",
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            "inline-block h-3 w-3 shrink-0 rounded-full",
            PROJECT_COLOR_DOT[project.color],
          )}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-section font-semibold text-foreground">
          {project.name}
        </span>
        <Badge className="shrink-0 font-mono">{project.key}</Badge>
      </span>
      <span className="sr-only">{projectColorAria(project.color)}</span>

      {project.description.trim().length > 0 ? (
        <span className="line-clamp-2 text-label leading-relaxed text-foreground-secondary">
          {project.description}
        </span>
      ) : null}

      <span className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-foreground-muted">
        <Badge tone={project.role === "OWNER" ? "brand" : "neutral"}>
          {project.role === "OWNER" ? "所有者" : "成员"}
        </Badge>
        {archived ? (
          <Badge tone="warning" icon={<Archive className="h-3 w-3" />}>
            已归档
          </Badge>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          {project.memberCount} 名成员
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
          {project.openTaskCount} 个未完成任务
        </span>
        <span className="ml-auto font-mono uppercase tracking-widest">
          {PROJECT_COLOR_LABEL[project.color]}
        </span>
      </span>
    </button>
  );
}
