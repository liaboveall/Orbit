"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import type { TaskDTO, ProjectDTO, MemberDTO, TaskSummaryDTO } from "@/contracts";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription, IconButton } from "@/components/ui";
import { TaskEditor } from "./task-editor";
import { TaskPanelPlaceholder } from "./task-panel-placeholder";

/**
 * 看板和列表的任务详情面板（`?task=<id>`）。
 *
 * 地址是唯一真源：任务数据由服务端页面按地址里的 task 读取后传入。打开和关闭都是一次
 * 路由 Transition，等待期间用 useOptimistic 先把面板切到目标状态：
 *  - 打开：面板立刻滑出，用卡片上已有的摘要排版占位，数据到达后原地换成编辑器；
 *  - 关闭：面板立刻收起，地址随后更新。导航失败时乐观状态自动回到地址对应的状态。
 *
 * 所选任务读不到（不存在、已删除或不属于本项目）时：
 *  - 面板里已经显示过它（例如别人刚删除）：保留最后一次内容和编辑器草稿，
 *    以只读状态显示，关闭仍走未保存确认；
 *  - 直接打开失效链接：显示说明和关闭按钮，页面其余部分照常可用。
 */

type PanelControl = {
  /** 正在显示（或正在打开）的任务 id；面板关闭时为 null。卡片据此立刻显示选中态。 */
  activeId: string | null;
  /**
   * 打开任务。传入点击事件时，普通左键会被接管为乐观导航；
   * 带修饰键的点击（新标签页等）不处理，交还给浏览器。
   */
  open: (task: TaskSummaryDTO, href: string, event?: MouseEvent) => void;
};

const PanelContext = createContext<PanelControl | null>(null);

/** 任务卡和列表行用它打开面板；不在面板宿主里（例如公开演示）时返回 null。 */
export function useTaskPanel(): PanelControl | null {
  return useContext(PanelContext);
}

/**
 * 面板里保留的内容。关闭动画期间、以及任务被他人删除后，仍显示最后一次读到的任务；
 * missing 表示服务端已按这条任务渲染过却没有读到它。
 */
type Held = { id: string; task: TaskDTO | null; summary: TaskSummaryDTO | null; missing: boolean };

/** 乐观目标：id 为 null 表示正在关闭；undefined 表示没有在途的打开或关闭。 */
type Pending = { id: string | null; summary: TaskSummaryDTO | null } | undefined;

export function TaskPanelHost({
  resolved,
  task,
  project,
  userId,
  today,
  members,
  children,
}: {
  /** 服务端这次渲染对应的 task 参数；用来区分「数据还没回来」和「服务端确认读不到」。 */
  resolved: string | null;
  /** 服务端按 resolved 读到的任务；读不到时为 null。 */
  task: TaskDTO | null;
  project: ProjectDTO;
  userId: string;
  today: string;
  members: MemberDTO[];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  // 地址里的任务 id 不区分大小写（服务端按 UUID 解析并返回小写 id），统一成小写再比较。
  const selection = search.get("task")?.toLowerCase() ?? null;
  const resolvedId = resolved?.toLowerCase() ?? null;
  const content = useRef<HTMLDivElement>(null);
  /** 最近一次打开的时刻：双击卡片的第二下落在刚出现的遮罩上，不应把面板又关掉。 */
  const openedAt = useRef(0);
  const [, startTransition] = useTransition();
  const [pending, setPending] = useOptimistic<Pending>(undefined);

  const activeId = pending !== undefined ? pending.id : selection;
  const liveTask = task !== null && task.id === activeId ? task : null;

  const [held, setHeld] = useState<Held | null>(() =>
    selection === null ? null : { id: selection, task: liveTask, summary: null, missing: resolvedId === selection && liveTask === null },
  );
  // 只在面板打开时跟随数据；关闭后保留最后的内容，退场动画期间版面不变，
  // 重新打开同一条任务时先显示上次的内容，再由新数据替换。
  if (activeId !== null) {
    const same = held?.id === activeId ? held : null;
    const next: Held = {
      id: activeId,
      task: liveTask ?? same?.task ?? null,
      summary: pending?.summary ?? same?.summary ?? null,
      missing: resolvedId === activeId && liveTask === null,
    };
    if (!same || same.task !== next.task || same.summary !== next.summary || same.missing !== next.missing) setHeld(next);
  }
  const shown = activeId !== null && held?.id !== activeId ? null : held;

  const urlWithout = useCallback(() => {
    const next = new URLSearchParams(search.toString());
    next.delete("task");
    return pathname + (next.size ? `?${next}` : "");
  }, [pathname, search]);

  const close = useCallback(() => {
    const href = urlWithout();
    startTransition(() => {
      setPending({ id: null, summary: null });
      router.replace(href, { scroll: false });
    });
  }, [router, setPending, urlWithout]);

  const open = useCallback<PanelControl["open"]>(
    (summary, href, event) => {
      if (event) {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
      }
      openedAt.current = performance.now();
      startTransition(() => {
        setPending({ id: summary.id, summary });
        router.push(href, { scroll: false });
      });
    },
    [router, setPending],
  );

  const control = useMemo(() => ({ activeId, open }), [activeId, open]);

  // Escape、遮罩和关闭按钮共用编辑器里的未保存确认。
  function requestClose() {
    content.current?.querySelector<HTMLButtonElement>('button[aria-label="关闭详情"]')?.click();
  }

  return (
    <PanelContext value={control}>
      {children}
      <Drawer
        open={activeId !== null}
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
      >
        <DrawerContent
          ref={content}
          side="right"
          showCloseButton={false}
          className="scrollbar-quiet w-full overflow-y-auto overscroll-contain sm:w-[min(var(--task-panel-width),calc(100vw-20px))]"
          // 焦点先落在面板容器上：占位内容换成编辑器时，原来聚焦的按钮会被卸载，
          // 焦点停在容器上才不会丢；下一次 Tab 进入第一个控件。
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            content.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            requestClose();
          }}
          onInteractOutside={(event) => {
            event.preventDefault();
            if (performance.now() - openedAt.current < 400) return;
            requestClose();
          }}
          onCloseAutoFocus={(event) => {
            // 焦点回到触发的任务卡；跨断点后原卡片被隐藏时，回到当前可见的那一个或看板。
            event.preventDefault();
            const candidates = held
              ? Array.from(
                  document.querySelectorAll<HTMLElement>(
                    `[data-task-link="${held.id}"], [data-task-card-link="${held.id}"]`,
                  ),
                )
              : [];
            const link = candidates.find((el) => el.getClientRects().length > 0) ?? candidates[0] ?? null;
            (link ?? document.querySelector<HTMLElement>("[data-project-content]"))?.focus();
          }}
        >
          <DrawerTitle className="sr-only">任务详情</DrawerTitle>
          <DrawerDescription>查看任务并保存编辑。</DrawerDescription>
          {shown?.task ? (
            <TaskEditor
              key={shown.id}
              members={members}
              task={shown.task}
              currentUserId={userId}
              today={today}
              readOnly={project.archivedAt !== null}
              unavailable={shown.missing}
              isProjectOwner={project.role === "OWNER"}
              canDelete={!shown.missing && (project.role === "OWNER" || shown.task.creator.id === userId)}
              onClose={close}
              onDeleted={close}
            />
          ) : shown?.missing ? (
            <section className="space-y-3 p-5 sm:p-6">
              <header className="flex items-center justify-between gap-3">
                <h2 className="text-section font-semibold tracking-[-0.012em]">任务不存在或已被删除</h2>
                <IconButton label="关闭详情" size="sm" className="bg-surface-sunken" onClick={close}>
                  <X className="h-4 w-4" />
                </IconButton>
              </header>
              <p role="status" className="text-label leading-relaxed text-foreground-secondary">
                它可能已被移入回收站，或链接有误。关闭后可继续浏览本项目。
              </p>
            </section>
          ) : (
            <TaskPanelPlaceholder summary={shown?.summary ?? null} onClose={close} />
          )}
        </DrawerContent>
      </Drawer>
    </PanelContext>
  );
}
