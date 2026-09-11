import "server-only";
import { TaskSchema, type TaskDTO } from "@/contracts";
import type { Prisma } from "@/generated/prisma/client";
import { taskNotFoundError } from "./access";

/** 调用方持有项目锁且已经重新鉴权；缓存不能绕过任务当前可读性。 */
export async function readTaskReplay(
  tx: Prisma.TransactionClient, projectId: string,
  replay: { resourceId: string | null; body: unknown },
): Promise<TaskDTO> {
  projectId = projectId.toLowerCase();
  if (!replay.resourceId) throw taskNotFoundError();
  const task = await tx.task.findUnique({ where: { id: replay.resourceId } });
  if (!task || task.projectId !== projectId || task.deletedAt !== null) throw taskNotFoundError();
  const cached = TaskSchema.parse(replay.body);
  if (cached.id !== task.id || cached.projectId !== projectId) throw taskNotFoundError();
  return cached;
}
