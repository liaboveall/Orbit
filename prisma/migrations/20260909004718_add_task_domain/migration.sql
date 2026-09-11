-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "creatorId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "title" VARCHAR(120) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NONE',
    "dueDate" DATE,
    "position" BIGINT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_projectId_deletedAt_status_position_id_idx" ON "Task"("projectId", "deletedAt", "status", "position", "id");

-- CreateIndex
CREATE INDEX "Task_projectId_deletedAt_updatedAt_id_idx" ON "Task"("projectId", "deletedAt", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "Task_assigneeId_deletedAt_status_dueDate_id_idx" ON "Task"("assigneeId", "deletedAt", "status", "dueDate", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Task_projectId_number_key" ON "Task"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Task_id_projectId_key" ON "Task"("id", "projectId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Task CHECK 约束（docs/04 §3）：Prisma schema 无法表达，手写补齐。
-- number 为正：任务编号项目内递增且从 1 起。
ALTER TABLE "Task" ADD CONSTRAINT "Task_number_positive_check" CHECK ("number" > 0);
-- version 为正：乐观并发版本号 >= 1。
ALTER TABLE "Task" ADD CONSTRAINT "Task_version_positive_check" CHECK ("version" > 0);
-- 标题 trim 后非空：拒绝全空白标题（与契约 min(1) + 服务端 trim 一致）。
ALTER TABLE "Task" ADD CONSTRAINT "Task_title_not_blank_check" CHECK (btrim("title") <> '');
-- DONE 当且仅当 completedAt 非空（含软删除任务）：状态与完成时刻强一致。
ALTER TABLE "Task" ADD CONSTRAINT "Task_done_completed_check" CHECK (("status" = 'DONE') = ("completedAt" IS NOT NULL));
