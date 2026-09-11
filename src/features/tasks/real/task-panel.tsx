"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";
import type { TaskDTO, ProjectDTO, MemberDTO } from "@/contracts";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui";
import { TaskEditor } from "./task-editor";

export function TaskPanel({
  task,
  project,
  userId,
  today,
  members,
}: {
  task: TaskDTO;
  project: ProjectDTO;
  userId: string;
  today: string;
  members: MemberDTO[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const content = useRef<HTMLDivElement>(null);
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
          const link = document.querySelector<HTMLElement>(
            `[data-task-link="${task.id}"]`,
          );
          (
            link ??
            document.querySelector<HTMLElement>("[data-project-content]")
          )?.focus();
        }}
      >
        <DrawerTitle className="sr-only">任务详情</DrawerTitle>
        <DrawerDescription>查看任务并保存编辑。</DrawerDescription>
        <TaskEditor
          members={members}
          task={task}
          currentUserId={userId}
          today={today}
          readOnly={project.archivedAt !== null}
          isProjectOwner={project.role === "OWNER"}
          canDelete={project.role === "OWNER" || task.creator.id === userId}
          onClose={close}
          onDeleted={close}
        />
      </DrawerContent>
    </Drawer>
  );
}
