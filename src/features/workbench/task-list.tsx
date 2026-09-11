"use client";

import { Skeleton } from "@/components/ui/skeleton";
import type { TaskSummaryDTO } from "@/contracts";
import { useEffect, useState } from "react";

/**
 * 我的任务列表容器（待实现）。
 * 使用 GET /api/v1/my/tasks?bucket=... 获取真实数据。
 */
export function MyTasksList({ currentUserId }: { currentUserId: string }) {
  const [tasks, setTasks] = useState<TaskSummaryDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      // TODO: fetch from /api/v1/my/tasks
      setLoading(true);
      await new Promise((resolve) => setTimeout(resolve, 500));
      // Placeholder empty state
      setTasks([]);
      setLoading(false);
      setError(null);
    } catch {
      setLoading(false);
      setError("无法加载任务列表");
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface p-4">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-48 mt-2" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-center text-danger">
        <p className="text-caption">{error}</p>
      </div>
    );
  }

  if (!tasks || tasks.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface p-12 text-center">
        <p className="text-caption text-foreground-muted">暂无任务</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => (
        <a
          key={task.id}
          href={`/app/projects/${task.projectId}/tasks/${task.id}`}
          className="block rounded-xl border border-line bg-surface p-4 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <span className="font-mono text-caption text-foreground-muted">
                {task.identifier}
              </span>
              <p className="text-label font-medium text-foreground">{task.title}</p>
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}
