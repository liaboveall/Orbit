import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import { deleteObject } from "@/server/modules/storage/client";
/** Only IDs allocated by this fixture are ever eligible for cleanup. */
export async function m5Fixture() {
  const ids = [randomUUID(), randomUUID(), randomUUID()],
    projectId = randomUUID(),
    taskId = randomUUID();
  const cleanup = async () => {
    const files = await prisma.attachment.findMany({
      where: { projectId },
      select: { objectKey: true },
    });
    for (const file of files) await deleteObject(file.objectKey);
    await prisma.attachment.deleteMany({ where: { projectId } });
    await prisma.comment.deleteMany({ where: { task: { projectId } } });
    await prisma.subtask.deleteMany({ where: { task: { projectId } } });
    await prisma.activityLog.deleteMany({ where: { projectId } });
    await prisma.idempotencyRecord.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.moveRecord.deleteMany({ where: { task: { projectId } } });
    await prisma.task.deleteMany({ where: { projectId } });
    await prisma.projectMember.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  };
  try {
    for (const [i, id] of ids.entries())
      await prisma.user.create({
        data: {
          id,
          email: `m5-${id}@orbit.test`,
          name: ["所有者", "成员", "非成员"][i]!,
          emailVerified: true,
          timezone: "Asia/Shanghai",
        },
      });
    await prisma.project.create({
      data: {
        id: projectId,
        ownerId: ids[0]!,
        key: "M" + randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase(),
        name: "M5 验收项目",
        color: "BLUE",
      },
    });
    await prisma.projectMember.create({ data: { projectId, userId: ids[1]! } });
    await prisma.task.create({
      data: {
        id: taskId,
        projectId,
        number: 1,
        creatorId: ids[0]!,
        assigneeId: ids[1]!,
        title: "M5 验收任务",
        position: 1024n,
      },
    });
    return {
      owner: ids[0]!,
      member: ids[1]!,
      outsider: ids[2]!,
      projectId,
      taskId,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
