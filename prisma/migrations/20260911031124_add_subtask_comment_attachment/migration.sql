-- M5 子任务 / 评论 / 附件数据模型（docs/04 §3）。
-- 此迁移由 Prisma diff 从 orbit_test（M5 前基线）→ schema.prisma 生成，
-- 与 orbit_dev 中 20260911031124 记录的实际结构逐字节一致。

-- CreateEnum
CREATE TYPE "AttachmentState" AS ENUM ('UPLOADING', 'READY', 'FAILED', 'DELETED');

-- CreateTable
CREATE TABLE "Subtask" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "taskId" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subtask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "taskId" UUID NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "clientUploadId" UUID NOT NULL,
    "claimedSha256" CHAR(64) NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "declaredSizeBytes" BIGINT NOT NULL,
    "sizeBytes" BIGINT,
    "sha256" CHAR(64),
    "state" "AttachmentState" NOT NULL,
    "cleanupPending" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Subtask_taskId_deletedAt_createdAt_id_idx" ON "Subtask"("taskId", "deletedAt", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Subtask_taskId_id_key" ON "Subtask"("taskId", "id");

-- CreateIndex
CREATE INDEX "Comment_taskId_createdAt_id_idx" ON "Comment"("taskId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Comment_taskId_id_key" ON "Comment"("taskId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_objectKey_key" ON "Attachment"("objectKey");

-- CreateIndex
CREATE INDEX "Attachment_taskId_state_createdAt_id_idx" ON "Attachment"("taskId", "state", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Attachment_state_cleanupPending_updatedAt_idx" ON "Attachment"("state", "cleanupPending", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_taskId_id_key" ON "Attachment"("taskId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_taskId_uploaderId_clientUploadId_key" ON "Attachment"("taskId", "uploaderId", "clientUploadId");

-- AddForeignKey
ALTER TABLE "Subtask" ADD CONSTRAINT "Subtask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
