"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, Menu } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
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
import { useRecentProjects } from "./use-recent-projects";
import { OrbitWordmark } from "./orbit-logo";
import { UserMenu } from "./user-menu";
import { useGuardedNavigate } from "@/features/tasks/unsaved-changes";
import { pruneDrafts } from "@/features/tasks/draft-storage";
import { UserTimezoneProvider } from "@/lib/user-timezone";

// Responsive navigation shares recent projects only within the signed-in session.
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
  recent,
}: {
  recent: ReturnType<typeof useRecentProjects>;
  mode: NavMode;
  pathname: string;
  user: UserDTO;
  onNavigate?: () => void;
}) {
  // B6 修复：程序化导航同样受未保存草稿保护（脏表单未确认放弃时不离开）。
  const guardedNavigate = useGuardedNavigate();
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
          最近项目
        </p>

        {recent.loading && <p role="status" className={cn("px-3 text-caption text-foreground-muted", labelClass(mode))}>加载项目中…</p>}
        {recent.error && <button type="button" onClick={recent.retry} aria-label="重新加载最近项目" className="min-h-11 w-full rounded-control px-2 text-caption text-danger focus-visible:outline-2">项目加载失败，重试</button>}
        {!recent.loading && !recent.error && recent.projects.length === 0 && <p className={cn("px-3 text-caption text-foreground-muted", labelClass(mode))}>暂无项目，从全部项目开始。</p>}
        <ul className="space-y-1">
          {recent.projects.map((project) => {
            const href = `/app/projects/${project.id}/board`;
            const active = pathname.startsWith(`/app/projects/${project.id}/`);
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
            门禁约束：必须保持 <button type="button"> + aria-label（tests/ui/accessibility-and-layout.spec.ts
            用 getByRole("button") 断言），且绝不能移入上方 <ul>（ul 仅包含当前用户的最近项目）。 */}
        <Tooltip content="全部项目" side="right">
          <button
            type="button"
            aria-label="全部项目"
            aria-current={projectsActive ? "page" : undefined}
            onClick={() => {
              guardedNavigate.push("/app/projects");
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
  const recent = useRecentProjects(user.id);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 共享浏览器换账号：删除其他账号留下的本机草稿与已过期草稿（生命周期见 draft-storage）。
  useEffect(() => {
    pruneDrafts(user.id);
  }, [user.id]);
  // 编程式打开的手机抽屉导航：打开瞬间记录焦点，关闭后还给汉堡按钮（docs/02：关闭后恢复焦点）。
  const { captureFocus, handleCloseAutoFocus } =
    useFocusReturn<HTMLButtonElement>();

  return (
    // F23 修复：会话用户的时区作为事件时间展示的统一来源（详情见 lib/user-timezone）。
    <UserTimezoneProvider value={user.timezone}>
    <div className="min-h-dvh bg-background">
      {/* F31⑥：键盘用户跳过导航直达主内容（docs/02 §6） */}
      <a
        href="#app-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-brand focus:px-4 focus:py-2 focus:text-label focus:font-medium focus:text-white"
      >
        跳到主内容
      </a>
      {/* 固定侧栏：手机隐藏，平板 72px，桌面 224px */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[72px] border-r border-line bg-surface md:block xl:w-56">
        <SidebarNav mode="rail" pathname={pathname} user={user} recent={recent} />
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
              recent={recent}
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

        <main id="app-main" className="flex-1 px-4 py-6 md:px-6 xl:px-8">
          {children}
        </main>
      </div>
    </div>
    </UserTimezoneProvider>
  );
}
