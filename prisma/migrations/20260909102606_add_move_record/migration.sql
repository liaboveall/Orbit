-- CreateTable
CREATE TABLE "MoveRecord" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "taskId" UUID NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "fromPosition" BIGINT NOT NULL,
    "toPosition" BIGINT NOT NULL,
    "boardVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoveRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MoveRecord_taskId_idx" ON "MoveRecord"("taskId");

-- CreateIndex
CREATE INDEX "MoveRecord_createdAt_idx" ON "MoveRecord"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "MoveRecord" ADD CONSTRAINT "MoveRecord_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
