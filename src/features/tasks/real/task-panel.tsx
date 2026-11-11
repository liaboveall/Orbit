"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { X } from "lucide-react";
import type { TaskDTO, ProjectDTO, MemberDTO } from "@/contracts";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription, IconButton } from "@/components/ui";
import { TaskEditor } from "./task-editor";

/**
 * 看板和列表的任务详情面板（`?task=<id>`）。
 *
 * task 为 null 表示项目可访问，但所选任务不存在、已删除或不属于本项目：
 *  - 面板已经打开过该任务（例如别人刚删除）：保留最后一次内容和编辑器草稿，
 *    以只读状态显示，关闭仍走未保存确认；
 *  - 直接打开失效链接：显示说明和关闭按钮，页面其余部分照常可用。
 */
export function TaskPanel({
  task,
  project,
  userId,
  today,
  members,
}: {
  task: TaskDTO | null;
  project: ProjectDTO;
  userId: string;
  today: string;
  members: MemberDTO[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const content = useRef<HTMLDivElement>(null);
  const [lastTask, setLastTask] = useState(task);
  if (task !== null && task !== lastTask) setLastTask(task);
  const shown = task ?? lastTask;

  function close() {
    const next = new URLSearchParams(search.toString());
    next.delete("task");
    router.replace(pathname + (next.size ? "?" + next.toString() : ""), { scroll: false });
  }
  // Escape、遮罩和关闭按钮共用编辑器里的未保存确认。
  function requestClose() {
    content.current?.querySelector<HTMLButtonElement>('button[aria-label="关闭详情"]')?.click();
  }

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DrawerContent
        ref={content}
        side="right"
        showCloseButton={false}
        className="w-full overflow-y-auto overscroll-contain sm:w-[min(var(--task-panel-width),calc(100vw-20px))]"
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          requestClose();
        }}
        onInteractOutside={(event) => {
          event.preventDefault();
          requestClose();
        }}
        onCloseAutoFocus={(event) => {
          // 焦点回到触发的任务卡；跨断点后原卡片被隐藏时，回到当前可见的那一个或看板。
          event.preventDefault();
          const candidates = shown
            ? Array.from(
                document.querySelectorAll<HTMLElement>(
                  `[data-task-link="${shown.id}"], [data-task-card-link="${shown.id}"]`,
                ),
              )
            : [];
          const link = candidates.find((el) => el.getClientRects().length > 0) ?? candidates[0] ?? null;
          (link ?? document.querySelector<HTMLElement>("[data-project-content]"))?.focus();
        }}
      >
        <DrawerTitle className="sr-only">任务详情</DrawerTitle>
        <DrawerDescription>查看任务并保存编辑。</DrawerDescription>
        {shown ? (
          <TaskEditor
            members={members}
            task={shown}
            currentUserId={userId}
            today={today}
            readOnly={project.archivedAt !== null}
            unavailable={task === null}
            isProjectOwner={project.role === "OWNER"}
            canDelete={task !== null && (project.role === "OWNER" || task.creator.id === userId)}
            onClose={close}
            onDeleted={close}
          />
        ) : (
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
        )}
      </DrawerContent>
    </Drawer>
  );
}
