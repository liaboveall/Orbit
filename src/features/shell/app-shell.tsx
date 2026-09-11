"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, LayoutGrid, Menu } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { UserDTO } from "@/contracts";
import { cn } from "@/lib/cn";
import { PROJECT_COLOR_DOT, projectColorAria } from "@/lib/project-color";
import { IconButton, useFocusReturn } from "@/components/ui";
import { Avatar } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { SIDEBAR_PROJECTS } from "./fixtures";
import { OrbitWordmark } from "./orbit-logo";
import { UserMenu } from "./user-menu";

/**
 * AppShell（ORB-002 布局，ORB-006 接入真实会话）：响应式应用外壳。
 *
 * docs/02 §4：
 *  - 桌面 ≥1280(xl)：左侧栏 224px（w-56），顶栏 64px，内容内边距 32px(px-8)。
 *  - 平板 768–1279(md)：侧栏收窄 72px，图标 + tooltip 保留完整标签，内边距 24px(px-6)。
 *  - 手机 <768(base)：侧栏隐藏，顶栏汉堡按钮打开 Drawer 导航，内边距 16px(px-4)。
 *  - 外壳尺寸稳定（fixed 侧栏 + 固定顶栏高度），加载时不整屏 spinner；内容区骨架由各页负责。
 *  - 长项目名截断 + tooltip，不推挤主操作。页面主标题只出现一次（由各页在内容区渲染）。
 *
 * ORB-006 变更：当前用户由 `user` prop 传入（layout 用 getSessionUser 取得真实会话），
 * 不再引用 fixture 的 CURRENT_USER；侧栏底部与个人菜单直达 `/app/settings`。
 *
 * M2 Phase 6 变更：「全部项目」按钮导航到真实项目列表 `/app/projects`；
 * 样例横幅改为白名单判定（isRealDataPage）：设置页与项目/任务/回收站真实数据页
 * 不挂横幅，today/board/task 详情/ui-samples 仍是 fixture 样例、继续显示。
 * 侧栏项目导航仍为 M0 fixture（保持 6 项，后续里程碑接真实项目列表）。
 */

/** NODE_ENV 是构建期常量：生产构建把开发分支作为死代码消除。 */
const isDev = process.env.NODE_ENV === "development";

/**
 * 真实数据页判定（M2 Phase 6）：白名单内的路由展示真实私有数据，
 * 不挂「使用 fixture 合成数据」样例横幅；其余（samples/today/
 * samples/board/sample/tasks/task 详情/ui-samples）仍是 M0 样例，
 * 必须继续显示横幅（docs/13：样例内容必须明确标识）。
 * 项目 id 为 UUID（不含 `/`），[^/]+ 即精确匹配单层动态段。
 */
const PROJECT_TASKS_PATH = /^\/app\/projects\/[^/]+\/tasks$/;
const PROJECT_TASK_DETAIL_PATH = /^\/app\/projects\/[^/]+\/tasks\/[^/]+$/;
const PROJECT_TRASH_PATH = /^\/app\/projects\/[^/]+\/trash$/;
const PROJECT_BOARD_PATH = /^\/app\/projects\/[^/]+\/board$/;
// M4 真实数据分区页（成员 / 邀请 / 活动 / 设置）同样展示真实私有数据，不挂样例横幅。
const PROJECT_MEMBERS_PATH = /^\/app\/projects\/[^/]+\/members$/;
const PROJECT_INVITATIONS_PATH = /^\/app\/projects\/[^/]+\/invitations$/;
const PROJECT_ACTIVITY_PATH = /^\/app\/projects\/[^/]+\/activity$/;
const PROJECT_SETTINGS_PATH = /^\/app\/projects\/[^/]+\/settings$/;

function isRealDataPath(pathname: string): boolean {
  return (
    pathname.startsWith("/app/settings") ||
    pathname === "/app/projects" ||
    PROJECT_TASKS_PATH.test(pathname) ||
    // 真实任务详情独立页（ORB-010，M3 已接真实数据）不挂 fixture 横幅。
    PROJECT_TASK_DETAIL_PATH.test(pathname) ||
    PROJECT_TRASH_PATH.test(pathname) ||
    PROJECT_BOARD_PATH.test(pathname) ||
    PROJECT_MEMBERS_PATH.test(pathname) ||
    PROJECT_INVITATIONS_PATH.test(pathname) ||
    PROJECT_ACTIVITY_PATH.test(pathname) ||
    PROJECT_SETTINGS_PATH.test(pathname)
    // 注意：/app/samples/*、/app/today、/app/ui-samples 及仍为 fixture 的
    // 样例页必须继续显示横幅（docs/13）。
  );
}

type NavMode = "rail" | "drawer";

const itemBase =
  "flex w-full items-center rounded-control text-label font-medium outline-none " +
  "transition-colors duration-150 ease-standard";

const itemPad: Record<NavMode, string> = {
  rail: "h-10 justify-center gap-0 px-0 xl:h-10 xl:justify-start xl:gap-3 xl:px-3",
  drawer: "h-11 gap-3 px-3",
};

function navStateClass(active: boolean): string {
  return active
    ? "bg-brand-soft text-brand"
    : "text-foreground-secondary hover:bg-surface-sunken hover:text-foreground";
}

function labelClass(mode: NavMode): string {
  return mode === "rail"
    ? "hidden truncate xl:inline"
    : "min-w-0 flex-1 truncate";
}

/** 侧栏导航内容：rail（桌面/平板固定侧栏）与 drawer（手机抽屉）共用。 */
function SidebarNav({
  mode,
  pathname,
  user,
  onNavigate,
}: {
  mode: NavMode;
  pathname: string;
  user: UserDTO;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const todayActive = pathname.startsWith("/app/today");
  const settingsActive = pathname.startsWith("/app/settings");
  // 项目列表页（/app/projects，不含 fixture 的 /app/projects/[id]/board 等）为激活态。
  const projectsActive = pathname === "/app/projects";

  return (
    <div className="flex h-full flex-col">
      {/* 字标 */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center border-b border-line",
          mode === "rail" ? "justify-center xl:justify-start xl:px-4" : "px-4",
        )}
      >
        {mode === "rail" ? (
          <Link
            href="/app/today"
            onClick={onNavigate}
            aria-label="Orbit 首页"
            className="rounded-control outline-none"
          >
            <OrbitWordmark collapsed />
          </Link>
        ) : (
          <Link href="/app/today" onClick={onNavigate} aria-label="Orbit 首页">
            <OrbitWordmark />
          </Link>
        )}
      </div>

      <nav
        aria-label="主导航"
        className="flex-1 overflow-y-auto px-2 py-3 xl:px-3"
      >
        {/* 我的工作台 */}
        <Tooltip content="我的工作台" side="right">
          <Link
            href="/app/today"
            onClick={onNavigate}
            aria-current={todayActive ? "page" : undefined}
            aria-label="我的工作台"
            className={cn(itemBase, itemPad[mode], navStateClass(todayActive))}
          >
            <Home className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className={labelClass(mode)}>我的工作台</span>
          </Link>
        </Tooltip>

        {/* 项目分组标题 */}
        <p
          className={cn(
            "mt-5 mb-2 text-caption font-medium uppercase tracking-wide text-foreground-muted",
            mode === "rail" ? "hidden xl:block" : "px-3",
          )}
        >
          样例项目
        </p>

        <ul className="space-y-1">
          {SIDEBAR_PROJECTS.map((project) => {
            // M3 样例路由（分叉 1）：把 M0 fixture 看板迁移到 /app/samples/board/[projectId]
            const href = `/app/samples/board/${project.id}`;
            const active = pathname.startsWith(href);
            const dot = (
              <span
                className={cn(
                  "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
                  PROJECT_COLOR_DOT[project.color],
                )}
                aria-hidden="true"
              />
            );
            return (
              <li key={project.id}>
                <Tooltip
                  side="right"
                  content={
                    <span>
                      {project.name}
                      <span className="sr-only">
                        （{projectColorAria(project.color)}）
                      </span>
                    </span>
                  }
                >
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    aria-label={project.name}
                    className={cn(
                      itemBase,
                      itemPad[mode],
                      navStateClass(active),
                    )}
                  >
                    {mode === "rail" ? (
                      <>
                        <span className="xl:hidden">{dot}</span>
                        <span className="hidden items-center gap-3 xl:flex">
                          {dot}
                          <span className="min-w-0 flex-1 truncate">
                            {project.name}
                          </span>
                        </span>
                      </>
                    ) : (
                      <>
                        {dot}
                        <span className={labelClass(mode)}>{project.name}</span>
                      </>
                    )}
                  </Link>
                </Tooltip>
              </li>
            );
          })}
        </ul>

        {/* 项目列表入口（M2 Phase 6：导航到真实数据页 /app/projects）。
            门禁约束：必须保持 <button type="button"> + aria-label（tests/ui/m0-review.spec.ts
            用 getByRole("button") 断言），且绝不能移入上方 <ul>（ul a 数量锁定为 6）。 */}
        <Tooltip content="全部项目" side="right">
          <button
            type="button"
            aria-label="全部项目"
            aria-current={projectsActive ? "page" : undefined}
            onClick={() => {
              router.push("/app/projects");
              onNavigate?.();
            }}
            className={cn(
              itemBase,
              itemPad[mode],
              "mt-1",
              projectsActive
                ? "bg-brand-soft text-brand"
                : "text-foreground-muted hover:bg-surface-sunken hover:text-foreground",
            )}
          >
            <LayoutGrid className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className={labelClass(mode)}>全部项目</span>
          </button>
        </Tooltip>
      </nav>

      {/* 底部：当前账户 + 个人设置入口（真实会话数据，直达 /app/settings） */}
      <div
        className={cn(
          "shrink-0 border-t border-line p-2 xl:p-3",
          mode === "rail" && "flex justify-center xl:block",
        )}
      >
        <div
          className={cn(
            "items-center gap-3",
            mode === "rail" ? "hidden xl:flex" : "flex",
          )}
        >
          <Link
            href="/app/settings"
            onClick={onNavigate}
            aria-current={settingsActive ? "page" : undefined}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-3 rounded-control p-1 -m-1 outline-none",
              "transition-colors duration-150 ease-standard hover:bg-surface-sunken",
              settingsActive && "bg-brand-soft",
            )}
          >
            <Avatar name={user.name} size="md" />
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block truncate text-label font-medium",
                  settingsActive ? "text-brand" : "text-foreground",
                )}
              >
                {user.name}
              </span>
              <span className="block truncate text-caption text-foreground-muted">
                个人设置
              </span>
            </span>
          </Link>
          <UserMenu variant="settings" side="top" align="end" user={user} />
        </div>

        {/* rail（平板）下仅显示头像菜单（xl 桌面态用上面的展开块） */}
        {mode === "rail" ? (
          <div className="xl:hidden">
            <UserMenu variant="avatar" side="right" align="start" user={user} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AppShell({ user, children }: { user: UserDTO; children: ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 编程式打开的手机抽屉导航：打开瞬间记录焦点，关闭后还给汉堡按钮（docs/02：关闭后恢复焦点）。
  const { captureFocus, handleCloseAutoFocus } =
    useFocusReturn<HTMLButtonElement>();

  // 真实数据页（设置 / 项目列表 / 任务列表 / 回收站）不挂样例横幅；
  // fixture 页（today/board/task 详情/ui-samples）继续显示（白名单见 isRealDataPath）。
  const isRealDataPage = isRealDataPath(pathname);

  return (
    <div className="min-h-dvh bg-background">
      {/* 固定侧栏：手机隐藏，平板 72px，桌面 224px */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[72px] border-r border-line bg-surface md:block xl:w-56">
        <SidebarNav mode="rail" pathname={pathname} user={user} />
      </aside>

      {/* 手机抽屉导航（Radix Dialog：焦点陷阱 / Escape / 焦点恢复） */}
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent
          side="left"
          closeLabel="关闭导航"
          className="w-[min(85vw,300px)] p-0"
          onCloseAutoFocus={handleCloseAutoFocus}
        >
          <DrawerTitle className="sr-only">导航</DrawerTitle>
          <DrawerDescription>项目与工作台导航菜单</DrawerDescription>
          <div className="pt-10">
            <SidebarNav
              mode="drawer"
              pathname={pathname}
              user={user}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </DrawerContent>
      </Drawer>

      {/* 主列：左侧留出侧栏宽度 */}
      <div className="flex min-h-dvh flex-col md:pl-[72px] xl:pl-56">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur md:px-6 xl:px-8">
          {/* 汉堡按钮：仅手机显示 */}
          <IconButton
            label="打开导航菜单"
            className="md:hidden"
            onClick={() => {
              captureFocus();
              setDrawerOpen(true);
            }}
          >
            <Menu className="h-5 w-5" />
          </IconButton>

          <span className="text-label text-foreground-secondary">
            面向个人与学生小团队的项目协作
          </span>

          <span className="ml-auto flex items-center gap-2">
            {/* 真实会话时区（来自 GET /me 同源的账户档案），mono 强调其标识属性 */}
            <span className="hidden font-mono text-caption text-foreground-muted sm:inline">
              {user.timezone}
            </span>
            <Avatar name={user.name} size="md" />
          </span>
        </header>

        <main className="flex-1 px-4 py-6 md:px-6 xl:px-8">
          {isRealDataPage ? null : <SampleBanner showStateHint={isDev} />}
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * 样例横幅：明确 today/board/task 仍是 M0 布局样例、使用 fixture、未连接后端
 * （docs/13：样例内容必须明确标识，不能与真实私有数据混淆）。
 * `?state=` 六态切换提示仅在开发环境出现（切换面板也只在开发环境渲染）。
 */
function SampleBanner({ showStateHint }: { showStateHint: boolean }) {
  return (
    <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control border border-brand/30 bg-brand-soft px-3 py-2 text-caption text-brand">
      <span className="font-semibold">M0 布局样例</span>
      <span className="text-foreground-secondary">
        {showStateHint
          ? "使用 fixture 合成数据，未连接真实后端 · 用 URL 的 ?state= 切换六态（见右下角面板）"
          : "使用 fixture 合成数据，未连接真实后端"}
      </span>
    </p>
  );
}
