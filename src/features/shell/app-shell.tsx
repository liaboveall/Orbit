"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, Menu } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { UserDTO } from "@/contracts";
import { cn } from "@/lib/cn";
import { projectColorAria } from "@/lib/project-color";
import { useFocusReturn } from "@/components/ui";
import { Avatar } from "@/components/ui/avatar";
import { LinkLabel } from "@/components/ui/link-label";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ProjectGlyph } from "@/features/projects/project-glyph";
import { useRecentProjects } from "./use-recent-projects";
import { OrbitWordmark } from "./orbit-logo";
import { UserMenu } from "./user-menu";
import { useGuardedNavigate } from "@/features/tasks/unsaved-changes";
import { pruneDrafts } from "@/features/tasks/draft-storage";
import { UserTimezoneProvider } from "@/lib/user-timezone";

// 导航内容在桌面侧栏（rail）和手机抽屉（drawer）之间共用。
type NavMode = "rail" | "drawer";

const itemBase =
  "flex w-full items-center rounded-[14px] text-left text-label font-medium outline-none " +
  "transition-[background-color,color,transform] duration-200 ease-standard active:scale-[0.98]";

const itemPad: Record<NavMode, string> = {
  rail: "h-11 justify-center xl:h-10 xl:justify-start xl:gap-3 xl:px-3",
  drawer: "h-12 gap-3 px-3",
};

function navStateClass(active: boolean): string {
  return active
    ? "selected-glass text-foreground [&_svg]:text-brand-ink"
    : "text-foreground-secondary hover:bg-surface-sunken hover:text-foreground";
}

function labelClass(mode: NavMode): string {
  return mode === "rail" ? "hidden truncate xl:inline" : "min-w-0 flex-1 truncate";
}

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
  // 程序化导航同样受未保存草稿保护。
  const guardedNavigate = useGuardedNavigate();
  const todayActive = pathname.startsWith("/app/today");
  const settingsActive = pathname.startsWith("/app/settings");
  const projectsActive = pathname === "/app/projects";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          "flex h-16 shrink-0 items-center",
          mode === "rail" ? "justify-center xl:justify-start xl:px-5" : "px-4",
        )}
      >
        <Link
          href="/app/today"
          onClick={onNavigate}
          aria-label="Orbit 首页"
          className="rounded-[10px] outline-none"
        >
          <OrbitWordmark collapsed={mode === "rail"} />
        </Link>
      </div>

      <nav aria-label="主导航" className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 xl:px-3">
        <div className="space-y-0.5">
          <Tooltip content="我的工作台" side="right" className="xl:hidden">
            <Link
              href="/app/today"
              onClick={onNavigate}
              aria-current={todayActive ? "page" : undefined}
              aria-label="我的工作台"
              className={cn(itemBase, itemPad[mode], navStateClass(todayActive))}
            >
              <Home className="h-5 w-5 shrink-0" aria-hidden="true" />
              <LinkLabel className={labelClass(mode)}>我的工作台</LinkLabel>
            </Link>
          </Tooltip>

          {/* 全部项目是导航动作，不属于下方仅含最近项目的列表。 */}
          <Tooltip content="全部项目" side="right" className="xl:hidden">
            <button
              type="button"
              aria-label="全部项目"
              aria-current={projectsActive ? "page" : undefined}
              onClick={() => {
                guardedNavigate.push("/app/projects");
                onNavigate?.();
              }}
              className={cn(itemBase, itemPad[mode], navStateClass(projectsActive))}
            >
              <LayoutGrid className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className={labelClass(mode)}>全部项目</span>
            </button>
          </Tooltip>
        </div>

        <p
          className={cn(
            "mb-1.5 mt-6 px-3 text-caption font-medium text-foreground-muted",
            mode === "rail" && "hidden xl:block",
          )}
        >
          最近项目
        </p>
        {mode === "rail" ? <div aria-hidden="true" className="mx-auto my-3 h-px w-6 bg-line xl:hidden" /> : null}

        {recent.loading && (
          <p role="status" className={cn("px-3 text-caption text-foreground-muted", labelClass(mode))}>
            加载项目中…
          </p>
        )}
        {recent.error && (
          <button
            type="button"
            onClick={recent.retry}
            aria-label="重新加载最近项目"
            className="min-h-11 w-full rounded-[14px] px-2 text-caption text-danger"
          >
            项目加载失败，重试
          </button>
        )}
        {!recent.loading && !recent.error && recent.projects.length === 0 && (
          <p className={cn("px-3 text-caption text-foreground-muted", labelClass(mode))}>
            暂无项目，从全部项目开始。
          </p>
        )}
        <ul className="space-y-0.5">
          {recent.projects.map((project) => {
            const active = pathname.startsWith(`/app/projects/${project.id}/`);
            return (
              <li key={project.id}>
                <Tooltip
                  side="right"
                  content={
                    <span>
                      {project.name}
                      <span className="sr-only">（{projectColorAria(project.color)}）</span>
                    </span>
                  }
                >
                  <Link
                    href={`/app/projects/${project.id}/board`}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    aria-label={project.name}
                    className={cn(itemBase, itemPad[mode], navStateClass(active))}
                  >
                    <ProjectGlyph name={project.name} color={project.color} />
                    <LinkLabel className={labelClass(mode)}>{project.name}</LinkLabel>
                  </Link>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className={cn("shrink-0 p-2.5 xl:p-3", mode === "rail" && "flex justify-center xl:block")}>
        <div className={cn("items-center gap-1", mode === "rail" ? "hidden xl:flex" : "flex")}>
          <Link
            href="/app/settings"
            onClick={onNavigate}
            aria-current={settingsActive ? "page" : undefined}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2.5 rounded-[14px] p-1.5 outline-none",
              "transition-colors duration-200 ease-standard hover:bg-surface-sunken",
              settingsActive && "selected-glass",
            )}
          >
            <Avatar name={user.name} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label font-medium text-foreground">{user.name}</span>
              <span className="block truncate text-caption text-foreground-muted">个人设置</span>
            </span>
          </Link>
          <UserMenu variant="settings" side="top" align="end" user={user} />
        </div>
        {mode === "rail" ? (
          <div className="xl:hidden">
            <UserMenu variant="avatar" side="right" align="start" user={user} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 手机底部的浮动标签栏。菜单项打开包含最近项目与账户的抽屉。 */
function MobileTabBar({
  pathname,
  onOpenMenu,
}: {
  pathname: string;
  onOpenMenu: () => void;
}) {
  const tab =
    "flex h-12 min-w-[76px] flex-col items-center justify-center gap-0.5 rounded-full px-3 text-[11px] font-medium outline-none " +
    "transition-[background-color,color,transform] duration-200 ease-standard active:scale-[0.96]";
  const tabState = (active: boolean) =>
    active ? "selected-glass text-brand-ink" : "text-foreground-secondary";
  const todayActive = pathname.startsWith("/app/today");
  const projectsActive = pathname.startsWith("/app/projects");
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 flex justify-center md:hidden">
      <nav aria-label="快捷导航" className="glass pointer-events-auto flex items-center gap-0.5 rounded-full p-1">
        <Link href="/app/today" aria-current={todayActive ? "page" : undefined} className={cn(tab, tabState(todayActive))}>
          <Home className="h-5 w-5" aria-hidden="true" />
          工作台
        </Link>
        <Link href="/app/projects" aria-current={projectsActive ? "page" : undefined} className={cn(tab, tabState(projectsActive))}>
          <LayoutGrid className="h-5 w-5" aria-hidden="true" />
          项目
        </Link>
        <button type="button" aria-label="打开导航菜单" onClick={onOpenMenu} className={cn(tab, tabState(false))}>
          <Menu className="h-5 w-5" aria-hidden="true" />
          菜单
        </button>
      </nav>
    </div>
  );
}

export function AppShell({ user, children }: { user: UserDTO; children: ReactNode }) {
  const pathname = usePathname();
  const recent = useRecentProjects(user.id);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 共享浏览器换账号：删除其他账号留下的本机草稿与已过期草稿。
  useEffect(() => {
    pruneDrafts(user.id);
  }, [user.id]);
  // 打开抽屉时记录焦点，关闭后还给触发按钮。
  const { captureFocus, handleCloseAutoFocus } = useFocusReturn<HTMLButtonElement>();

  return (
    <UserTimezoneProvider value={user.timezone}>
      <div className="min-h-dvh">
        <a
          href="#app-main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-label focus:font-medium focus:text-foreground-invert"
        >
          跳到主内容
        </a>

        {/* 桌面与平板：浮动玻璃侧栏，四周留出内边距 */}
        <aside className="glass fixed inset-y-3 left-3 z-30 hidden w-[72px] rounded-panel md:block xl:w-[248px]">
          <SidebarNav mode="rail" pathname={pathname} user={user} recent={recent} />
        </aside>

        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerContent side="bottom" closeLabel="关闭导航" onCloseAutoFocus={handleCloseAutoFocus}>
            <DrawerTitle className="sr-only">导航</DrawerTitle>
            <DrawerDescription>项目与工作台导航菜单</DrawerDescription>
            <SidebarNav
              mode="drawer"
              recent={recent}
              pathname={pathname}
              user={user}
              onNavigate={() => setDrawerOpen(false)}
            />
          </DrawerContent>
        </Drawer>

        <div className="md:pl-[96px] xl:pl-[272px]">
          <main
            id="app-main"
            className="mx-auto w-full max-w-[1480px] px-4 pb-32 pt-5 md:px-6 md:pb-12 md:pt-3 xl:px-8"
          >
            {children}
          </main>
        </div>

        <MobileTabBar
          pathname={pathname}
          onOpenMenu={() => {
            captureFocus();
            setDrawerOpen(true);
          }}
        />
      </div>
    </UserTimezoneProvider>
  );
}
