"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { X } from "lucide-react";
import type { TaskDTO, ProjectDTO, MemberDTO } from "@/contracts";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerDescription,
  IconButton,
} from "@/components/ui";
import { TaskEditor } from "./task-editor";

/**
 * 看板/列表的任务详情侧面板（`?task=<id>`）。
 *
 * task 为 null 表示项目可访问但所选任务不存在、已删除或不属于本项目：
 *  - 面板已打开过该任务（例如他人刚删除、后台刷新后）：保留最后一次内容与编辑器草稿，
 *    以只读「任务已删除」状态展示，关闭仍走未保存确认；
 *  - 直接打开失效链接：显示说明与关闭按钮，页面其余部分正常可用（不再整页 404）。
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
    router.replace(pathname + (next.size ? "?" + next.toString() : ""), {
      scroll: false,
    });
  }
  function requestClose() {
    content.current
      ?.querySelector<HTMLButtonElement>('button[aria-label="关闭详情"]')
      ?.click();
  }
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DrawerContent
        side="right"
        showCloseButton={false}
        className="w-full overflow-y-auto sm:w-[600px]"
        ref={content}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          requestClose();
        }}
        onInteractOutside={(e) => {
          e.preventDefault();
          requestClose();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const candidates = shown
            ? Array.from(
                document.querySelectorAll<HTMLElement>(
                  `[data-task-link="${shown.id}"], [data-task-card-link="${shown.id}"]`,
                ),
              )
            : [];
          const link =
            candidates.find((el) => el.getClientRects().length > 0) ??
            candidates[0] ??
            null;
          (
            link ??
            document.querySelector<HTMLElement>("[data-project-content]")
          )?.focus();
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
          <section className="space-y-4 p-4 sm:p-6">
            <header className="flex items-center justify-between border-b border-line pb-3">
              <h2 className="text-section font-semibold">任务不存在或已被删除</h2>
              <IconButton label="关闭详情" onClick={close}>
                <X className="h-4 w-4" />
              </IconButton>
            </header>
            <p role="status" className="text-label text-foreground-secondary">
              它可能已被移入回收站，或链接有误。关闭后可继续浏览本项目。
            </p>
          </section>
        )}
      </DrawerContent>
    </Drawer>
  );
}
