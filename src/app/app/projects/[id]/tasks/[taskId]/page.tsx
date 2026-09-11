import { headers } from "next/headers";
import { dateInTimezone } from "@/lib/calendar";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { loginPathWithReturnTo } from "@/lib/return-to";
import { getSessionUser } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getProject, listMembers } from "@/server/modules/project";
import { findTaskDetail } from "@/server/modules/task";
import { TaskDetailClient } from "@/features/tasks/real/task-detail-client";

/**
 * /app/projects/[id]/tasks/[taskId] · 任务详情「独立页」模式（ORB-010）。
 *
 * M3 Phase 3：真实数据集成。Server Component 通过领域服务读取任务详情与项目关系：
 *  - 会话缺失 → 重定向登录页（带 returnTo）；
 *  - `getProject` 内含成员关系判定：非成员/不存在 → NOT_FOUND → 404，不泄露信息；
 *  - `findTaskDetail` 按 task+project 双重校验归属，Deleted/无权限同样返回 NOT_FOUND；
 *  - 客户端组件接收 Server Component 直查得到的 taskDetail props，行内编辑走 POST/PATCH /api/v1 端点，
 *    成功回调 `router.refresh()` 刷新服务端缓存。
 *
 * ⚠️ 不再传递函数给子组件（M2 bug 规避），所有交互逻辑放在 Client Component 内部。
 */

export const metadata: Metadata = {
  title: "任务详情 · Orbit",
};

type PageProps = {
  params: Promise<{ id: string; taskId: string }>;
};

export default async function TaskDetailPage({ params }: PageProps) {
  const { id: routeProjectId, taskId } = await params;
  const sessionUser = await getSessionUser(await headers());
  if (!sessionUser) {
    redirect(loginPathWithReturnTo(`/app/projects/${routeProjectId}/tasks/${taskId}`));
  }

  let project;
  let taskDetail;
  try {
    // Q09 Fix: 串行读取并做双重归属验证
    // 1. 先验证当前用户有权限访问路由中的项目
    project = await getProject(routeProjectId, sessionUser.id);
    
    // 2. 再读取任务详情（也会验证成员关系）
    taskDetail = await findTaskDetail(taskId, sessionUser.id);
    
    // 3. **关键检查**：确保任务的 projectId 与路由中的 projectId 匹配
    // 如果不匹配 → 404（避免上下文混淆）
    if (taskDetail.projectId !== project.id) {
      notFound();
    }
  } catch (error) {
    // NOT_FOUND → 404，避免泄露项目/任务是否存在
    if (error instanceof DomainError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  const members = await listMembers(project.id, sessionUser.id);
  return (
    <div className="space-y-3">
      <Link
        href={`/app/projects/${routeProjectId}/board`}
        className="inline-flex items-center gap-1.5 rounded-control text-caption font-medium text-foreground-secondary outline-none hover:text-brand"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        返回看板
      </Link>

      {/* 独立页：卡片占满内容区宽度，内部高度独立滚动（与侧面板一致的滚动行为） */}
      <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-card border border-line bg-surface shadow-popover">
        <div className="h-[calc(100dvh-13rem)] min-h-[460px]">
          <TaskDetailClient members={members} 
            key={taskDetail.id} 
            taskDetail={taskDetail} 
            projectId={project.id} 
            currentUserId={sessionUser.id} 
            today={dateInTimezone(sessionUser.timezone)}
            readOnly={project.archivedAt !== null}
            canDelete={project.role === "OWNER" || taskDetail.creator.id === sessionUser.id}
          />
        </div>
      </div>
    </div>
  );
}
