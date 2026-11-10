"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, LayoutGrid, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { UserDTO } from "@/contracts";
import {
  Avatar,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  LinkLabel,
  Segments,
  Tooltip,
  useFocusReturn,
} from "@/components/ui";
import { ProjectGlyph } from "@/features/projects/project-glyph";
import { pruneDrafts } from "@/features/tasks/draft-storage";
import { cn } from "@/lib/cn";
import { projectColorAria } from "@/lib/project-color";
import { UserTimezoneProvider } from "@/lib/user-timezone";
import { OrbitWordmark } from "./orbit-logo";
import { useRecentProjects } from "./use-recent-projects";
import { UserMenu } from "./user-menu";

/**
 * 应用外壳：桌面是浮动的玻璃侧栏（中等宽度收窄成图标栏），手机是底部的玻璃标签栏，
 * 标签栏旁的头像打开包含最近项目和账户的抽屉。
 */

const PRIMARY: { key: string; href: string; label: string; short: string; icon: LucideIcon }[] = [
  { key: "today", href: "/app/today", label: "我的工作台", short: "工作台", icon: House },
  { key: "projects", href: "/app/projects", label: "全部项目", short: "项目", icon: LayoutGrid },
];

/** 当前路径对应的导航项：工作台、项目列表，或某个项目的 id。 */
function activeKeyOf(pathname: string): string | null {
  if (pathname.startsWith("/app/today")) return "today";
  if (pathname === "/app/projects") return "projects";
  return /^\/app\/projects\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

const itemClass =
  "flex h-11 w-full items-center gap-3 rounded-item px-2.5 text-label font-medium outline-none xl:h-10 " +
  "transition-[color,transform] duration-200 ease-standard active:scale-[0.98]";

function itemState(active: boolean): string {
  return active
    ? "text-foreground [&_svg]:text-brand-ink"
    : "text-foreground-secondary hover:bg-surface-sunken hover:text-foreground";
}

function NavContent({
  user,
  pathname,
  recent,
  collapsible = false,
  onNavigate,
}: {
  user: UserDTO;
  pathname: string;
  recent: ReturnType<typeof useRecentProjects>;
  /** 桌面侧栏在中等宽度收窄成图标栏；抽屉里始终展开。 */
  collapsible?: boolean;
  onNavigate?: () => void;
}) {
  const active = activeKeyOf(pathname);
  const label = cn("min-w-0 flex-1 truncate", collapsible && "hidden xl:block");
  const center = collapsible && "max-xl:justify-center max-xl:px-0";
  const note = cn("px-2.5 text-caption text-foreground-muted", collapsible && "hidden xl:block");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("flex h-[60px] shrink-0 items-center px-5", collapsible && "max-xl:justify-center max-xl:px-0")}>
        <Link href="/app/today" onClick={onNavigate} aria-label="Orbit 首页" className="rounded-control outline-none">
          <OrbitWordmark collapsed={collapsible} />
        </Link>
      </div>

      <nav aria-label="主导航" className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <Segments activeKey={active}>
          <div className="space-y-0.5">
            {PRIMARY.map(({ key, href, label: text, icon: Icon }) => (
              <Tooltip key={key} content={text} side="right" className="xl:hidden">
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-label={text}
                  aria-current={active === key ? "page" : undefined}
                  data-active={active === key || undefined}
                  className={cn(itemClass, center, itemState(active === key))}
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <LinkLabel className={label}>{text}</LinkLabel>
                </Link>
              </Tooltip>
            ))}
          </div>

          <p className={cn("mb-1 mt-6 px-2.5 text-caption font-medium text-foreground-muted", collapsible && "hidden xl:block")}>
            最近项目
          </p>
          {collapsible ? <div aria-hidden="true" className="mx-auto my-3 h-px w-6 bg-line xl:hidden" /> : null}

          {recent.loading ? (
            <p role="status" className={note}>
              加载项目中…
            </p>
          ) : null}
          {recent.error ? (
            <button
              type="button"
              onClick={recent.retry}
              aria-label="重新加载最近项目"
              className="min-h-11 w-full rounded-item px-2 text-caption text-danger outline-none hover:bg-danger-soft"
            >
              {collapsible ? <span className="xl:hidden">重试</span> : null}
              <span className={cn(collapsible && "hidden xl:inline")}>项目加载失败，重试</span>
            </button>
          ) : null}
          {!recent.loading && !recent.error && recent.projects.length === 0 ? (
            <p className={note}>暂无项目，从全部项目开始。</p>
          ) : null}
          <ul className="space-y-0.5">
            {recent.projects.map((project) => {
              const current = active === project.id;
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
                      aria-label={project.name}
                      aria-current={current ? "page" : undefined}
                      data-active={current || undefined}
                      className={cn(itemClass, center, itemState(current))}
                    >
                      <ProjectGlyph name={project.name} color={project.color} />
                      <LinkLabel className={label}>{project.name}</LinkLabel>
                    </Link>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        </Segments>
      </nav>

      <div className="shrink-0 p-3 pt-1">
        <UserMenu user={user} collapsible={collapsible} active={pathname.startsWith("/app/settings")} />
      </div>
    </div>
  );
}

/** 手机底部的玻璃标签栏：两个目的地是一颗胶囊，旁边的头像打开完整导航。 */
function TabBar({ user, pathname, onOpenMenu }: { user: UserDTO; pathname: string; onOpenMenu: () => void }) {
  const active = pathname.startsWith("/app/today") ? "today" : pathname.startsWith("/app/projects") ? "projects" : null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 flex items-center justify-center gap-2.5 md:hidden">
      <nav aria-label="快捷导航" data-lens="" className="glass pointer-events-auto rounded-full p-1">
        <Segments activeKey={active} className="flex items-center">
          {PRIMARY.map(({ key, href, short, icon: Icon }) => (
            <Link
              key={key}
              href={href}
              aria-current={active === key ? "page" : undefined}
              data-active={active === key || undefined}
              className={cn(
                "flex h-[52px] min-w-[88px] flex-col items-center justify-center gap-0.5 rounded-full px-4 text-[11px] font-medium outline-none",
                "transition-[color,transform] duration-200 ease-standard active:scale-[0.96]",
                active === key ? "text-brand-ink" : "text-foreground-secondary",
              )}
            >
              <Icon className="h-[22px] w-[22px]" aria-hidden="true" />
              {short}
            </Link>
          ))}
        </Segments>
      </nav>
      <button
        type="button"
        aria-label="打开导航菜单"
        data-lens=""
        onClick={onOpenMenu}
        className="glass pointer-events-auto flex h-[60px] w-[60px] items-center justify-center rounded-full outline-none transition-transform duration-200 ease-standard active:scale-[0.94]"
      >
        <Avatar name={user.name} size="lg" />
      </button>
    </div>
  );
}

export function AppShell({ user, children }: { user: UserDTO; children: ReactNode }) {
  const pathname = usePathname();
  const recent = useRecentProjects(user.id);
  const [menuOpen, setMenuOpen] = useState(false);
  // 共享浏览器换账号：删除其他账号留下的本机草稿和已过期草稿。
  useEffect(() => {
    pruneDrafts(user.id);
  }, [user.id]);
  // 打开抽屉时记录焦点，关闭后还给触发按钮。
  const { captureFocus, handleCloseAutoFocus } = useFocusReturn<HTMLButtonElement>();

  return (
    <UserTimezoneProvider value={user.timezone}>
      <a
        href="#app-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-label focus:font-medium focus:text-foreground-invert"
      >
        跳到主内容
      </a>

      <aside className="glass fixed inset-y-3 left-3 z-30 hidden w-[var(--shell-rail)] rounded-panel md:block xl:w-[var(--shell-sidebar)]">
        <NavContent user={user} pathname={pathname} recent={recent} collapsible />
      </aside>

      <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
        <DrawerContent side="bottom" closeLabel="关闭导航" onCloseAutoFocus={handleCloseAutoFocus}>
          <DrawerTitle className="sr-only">导航</DrawerTitle>
          <DrawerDescription>项目与工作台导航菜单</DrawerDescription>
          <NavContent user={user} pathname={pathname} recent={recent} onNavigate={() => setMenuOpen(false)} />
        </DrawerContent>
      </Drawer>

      <div className="md:pl-[calc(var(--shell-rail)+var(--shell-inset))] xl:pl-[calc(var(--shell-sidebar)+var(--shell-inset))]">
        <main id="app-main" className="mx-auto min-h-dvh w-full max-w-[1480px] px-4 pb-32 pt-4 md:px-7 md:pb-14 md:pt-5 xl:px-9">
          {children}
        </main>
      </div>

      <TabBar
        user={user}
        pathname={pathname}
        onOpenMenu={() => {
          captureFocus();
          setMenuOpen(true);
        }}
      />
    </UserTimezoneProvider>
  );
}
