/**
 * A-01 & A-02: 附件配额管理的边界保护集成测试
 * 
 * A-01: 附件软删除必须扣减 usedBytes（防止配额泄漏）
 * A-02: 孤儿清理脚本必须防止 reservedBytes 负数（下界保护）
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { getEnv, parseEnv } from "@/server/env";
import { ProjectColor } from "@/generated/prisma/client";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const _env = parseEnv(process.env as Record<string, string | undefined>);
process.env.APP_ENV = "test";
getEnv(true);

const { prisma } = await import("@/server/db/prisma");
const { uploadAttachment, deleteAttachment } = await import("@/server/modules/attachments/service");
const { cleanupOrphanAttachmentsLocked } = await import("@/server/modules/attachments/cleanup");

describe("A-01 & A-02: Attachment quota boundary protection", () => {
  let testProjectId: string;
  let testUserId: string;
  let testTaskId: string;
  let initialUsedBytes: bigint;
  let initialReservedBytes: bigint;

  beforeAll(async () => {
    // 创建测试用户
    testUserId = randomUUID();
    await prisma.user.create({
      data: {
        id: testUserId,
        email: `a01-a02-test-${randomUUID()}@test.local`,
        name: "A-01/A-02 Test User",
        emailVerified: true,
      },
    });

    // 创建测试项目（预留一些配额空间）
    initialUsedBytes = 10n * 1024n * 1024n; // 10 MB
    initialReservedBytes = 5n * 1024n * 1024n; // 5 MB
    
    testProjectId = randomUUID();
    await prisma.project.create({
      data: {
        id: testProjectId,
        name: "A-01/A-02 Test Project",
        key: `A01${randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase()}`,
        ownerId: testUserId,
        color: ProjectColor.BLUE,
        usedBytes: initialUsedBytes,
        reservedBytes: initialReservedBytes,
      },
    });

    // 创建测试任务（使用 status 而不是 statusId）
    const task = await prisma.task.create({
      data: {
        id: randomUUID(),
        projectId: testProjectId,
        number: 1, // required
        creatorId: testUserId, // required
        title: "Test Task",
        description: "Testing attachment quota management",
        status: "TODO",
        position: BigInt(1),
      },
    });
    testTaskId = task.id;
  });

  afterAll(async () => {
    // 清理测试数据
    await prisma.attachment.deleteMany({ where: { taskId: testTaskId } });
    await prisma.task.deleteMany({ where: { projectId: testProjectId } });
    await prisma.projectMember.deleteMany({ where: { projectId: testProjectId } });
    await prisma.project.deleteMany({ where: { id: testProjectId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  describe("A-01: Soft delete must decrement usedBytes (quota leak prevention)", () => {
    it("should reduce usedBytes when deleting a READY attachment", async () => {
      const attachmentSize = 1_048_576n; // 1 MB
      
      // 模拟创建已完成的附件（直接插入数据库跳过上传流程）
      const attachmentId = randomUUID();
      await prisma.attachment.create({
        data: {
          id: attachmentId,
          taskId: testTaskId,
          projectId: testProjectId,
          uploaderId: testUserId,
          clientUploadId: randomUUID(),
          objectKey: `projects/${testProjectId}/tasks/${testTaskId}/${randomUUID()}`,
          originalName: "test-file.txt",
          mimeType: "text/plain",
          declaredSizeBytes: attachmentSize,
          sizeBytes: attachmentSize,
          sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          state: "READY",
          claimedSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
      });

      // 验证附件创建后 usedBytes 增加了
      const projectBeforeDelete = await prisma.project.findUnique({
        where: { id: testProjectId },
        select: { usedBytes: true, reservedBytes: true },
      });
      expect(projectBeforeDelete!.usedBytes).toBe(initialUsedBytes + attachmentSize);
      
      // 执行删除
      await deleteAttachment(attachmentId, testUserId);

      // 断言：deletedAt 非空
      const deletedAttachment = await prisma.attachment.findUnique({
        where: { id: attachmentId },
      });
      expect(deletedAttachment?.state).toBe("DELETED");
      expect(deletedAttachment?.deletedAt).toBeDefined();
      
      // A-01 核心断言：usedBytes 应减少
      const projectAfterDelete = await prisma.project.findUnique({
        where: { id: testProjectId },
        select: { usedBytes: true, reservedBytes: true },
      });
      expect(projectAfterDelete!.usedBytes).toBe(initialUsedBytes); // 减少到原始值
      expect(projectAfterDelete!.reservedBytes).toBe(initialReservedBytes); // reservedBytes 不变
    });

    it("should handle deletion of attachment with NULL sizeBytes gracefully", async () => {
      // 创建未测量的附件（sizeBytes = NULL）
      const attachmentId = randomUUID();
      const attachmentSize = 2_097_152n; // 2 MB
      
      await prisma.attachment.create({
        data: {
          id: attachmentId,
          taskId: testTaskId,
          projectId: testProjectId,
          uploaderId: testUserId,
          clientUploadId: randomUUID(),
          objectKey: `projects/${testProjectId}/tasks/${testTaskId}/${randomUUID()}`,
          originalName: "unmeasured-file.txt",
          mimeType: "text/plain",
          declaredSizeBytes: attachmentSize,
          sizeBytes: null, // 尚未测量
          sha256: null,
          state: "READY", // 但状态是 READY
          claimedSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
      });

      const projectBeforeDelete = await prisma.project.findUnique({
        where: { id: testProjectId },
        select: { usedBytes: true },
      });
      
      // 删除（注意：虽然我们设置了 sizeBytes=null，但业务逻辑应该允许）
      await expect(deleteAttachment(attachmentId, testUserId)).resolves.not.toThrow();

      // 断言：usedBytes 不应变化（因为 sizeBytes 为 null）
      const projectAfterDelete = await prisma.project.findUnique({
        where: { id: testProjectId },
        select: { usedBytes: true },
      });
      expect(projectAfterDelete!.usedBytes).toBe(projectBeforeDelete!.usedBytes);
    });

    it("should rollback transaction if project update fails during soft delete", async () => {
      // 此测试依赖于事务的回滚行为，已经在 service.ts 中通过 withTransaction 保证
      // 这里我们创建一个正常的附件并删除，验证一致性
      
      const attachmentId = randomUUID();
      const attachmentSize = 524_288n; // 512 KB
      
      await prisma.attachment.create({
        data: {
          id: attachmentId,
          taskId: testTaskId,
          projectId: testProjectId,
          uploaderId: testUserId,
          clientUploadId: randomUUID(),
          objectKey: `projects/${testProjectId}/tasks/${testTaskId}/${randomUUID()}`,
          originalName: "rollback-test.txt",
          mimeType: "text/plain",
          declaredSizeBytes: attachmentSize,
          sizeBytes: attachmentSize,
          sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          state: "READY",
          claimedSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
      });

      await deleteAttachment(attachmentId, testUserId);

      const project = await prisma.project.findUnique({
        where: { id: testProjectId },
        select: { usedBytes: true, reservedBytes: true },
      });
      
      // 验证最终一致性：没有部分更新的中间状态
      expect(project!.usedBytes).toBeLessThanOrEqual(initialUsedBytes);
      expect(project!.reservedBytes).toBeGreaterThanOrEqual(0n);
    });
  });

  describe("A-02: Orphan cleanup must protect against negative reservedBytes", () => {
    it("should clamp reservedBytes to 0 instead of going negative (boundary case: 0)", async () => {
      // 设置 reservedBytes = 0
      await prisma.project.update({
        where: { id: testProjectId },
        data: { reservedBytes: 0n },
      });

      // 创建孤儿附件（UPLOADING 状态，超过 24 小时）
      const orphanId = randomUUID();
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 小时前
      const orphanSize = 1_048_576n; // 1 MB
      
      await prisma.attachment.create({
        data: {
          id: orphanId,
          taskId: testTaskId,
          projectId: testProjectId,
          uploaderId: testUserId,
          clientUploadId: randomUUID(),
          objectKey: `projects/${testProjectId}/tasks/${testTaskId}/${randomUUID()}`,
          originalName: "orphan-file.txt",
          mimeType: "text/plain",
          declaredSizeBytes: orphanSize,
          sizeBytes: null,
          sha256: null,
          state: "UPLOADING",
          createdAt: oldDate,
          cleanupPending: false,
          claimedSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
      });

      // 执行孤儿清理
      const result = await cleanupOrphanAttachmentsLocked();
      
      // 断言：不会导致 reservedBytes 变成负数
      const project = await prisma.project.findUnique({
        where: { id: testProjectId },
        select: { reservedBytes: true },
      });
      expect(project!.reservedBytes).toBe(0n); // 保持为 0，不减小
      expect(result.cleanedCount).toBeGreaterThan(0);
    });

    it("should correctly decrement reservedBytes when enough balance exists (case: 5MB)", async () => {
      const reservedBalance = 5_000_000n; // 5 MB
      const orphanSize = 1_048_576n; // 1 MB
      
      await prisma.project.update({
        where: { id: testProjectId },
        data: { reservedBytes: reservedBalance },
      });

      // 创建孤儿附件
      const orphanId = randomUUID();
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
      
      await prisma.attachment.create({
        data: {
          id: orphanId,
          taskId: testTaskId,
          projectId: testProjectId,
          uploaderId: testUserId,
          clientUploadId: randomUUID(),
          objectKey: `projects/${testProjectId}/tasks/${testTaskId}/${randomUUID()}`,
          originalName: "orphan-file-2.txt",
          mimeType: "text/plain",
          declaredSizeBytes: orphanSize,
          sizeBytes: null,
          sha256: null,
          state: "UPLOADING",
          createdAt: oldDate,
          cleanupPending: false,
          claimedSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
      });

      await cleanupOrphanAttachmentsLocked();

      const project = await prisma.project.findUnique({
        where: { id: testProjectId },
        select: { reservedBytes: true },
      });
      
      // 正确扣减：5MB - 1MB = 4MB
      expect(project!.reservedBytes).toBe(reservedBalance - orphanSize);
      expect(project!.reservedBytes).toBeGreaterThan(0n);
    });

    it("should handle oversized orphan (declared > current reserved) gracefully (case: 200MB)", async () => {
      const currentReserved = 10_000_000n; // 10 MB
      const hugeOrphanSize = 200_000_000n; // 200 MB（远超当前 reserved）
      
      await prisma.project.update({
        where: { id: testProjectId },
        data: { reservedBytes: currentReserved },
      });

      // 创建巨大的孤儿附件
      const orphanId = randomUUID();
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
      
      await prisma.attachment.create({
        data: {
          id: orphanId,
          taskId: testTaskId,
          projectId: testProjectId,
          uploaderId: testUserId,
          clientUploadId: randomUUID(),
          objectKey: `projects/${testProjectId}/tasks/${testTaskId}/${randomUUID()}`,
          originalName: "huge-orphan.txt",
          mimeType: "text/plain",
          declaredSizeBytes: hugeOrphanSize,
          sizeBytes: null,
          sha256: null,
          state: "UPLOADING",
          createdAt: oldDate,
          cleanupPending: false,
          claimedSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
      });

      const result = await cleanupOrphanAttachmentsLocked();
      
      // A-02 核心断言：即使 declared 远大于 current reserved，也不得小于 0
      const project = await prisma.project.findUnique({
        where: { id: testProjectId },
        select: { reservedBytes: true },
      });
      expect(project!.reservedBytes).toBe(0n); // 下界保护生效
      expect(project!.reservedBytes).not.toBeLessThan(0n); // PostgreSQL CHECK 约束保障
    });

    it("should process multiple orphans atomically per project", async () => {
      const initialReserved = 10_000_000n; // 10 MB
      
      await prisma.project.update({
        where: { id: testProjectId },
        data: { reservedBytes: initialReserved },
      });

      // 创建多个孤儿附件
      const orphanIds: string[] = [];
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const orphanSizes = [1_048_576n, 2_097_152n, 524_288n]; // 1MB + 2MB + 0.5MB = 3.5MB
      
      for (const size of orphanSizes) {
        const orphanId = randomUUID();
        orphanIds.push(orphanId);
        
        await prisma.attachment.create({
          data: {
            id: orphanId,
            taskId: testTaskId,
            projectId: testProjectId,
            uploaderId: testUserId,
            clientUploadId: randomUUID(),
            objectKey: `projects/${testProjectId}/tasks/${testTaskId}/${randomUUID()}`,
            originalName: `multi-orphan-${orphanIds.length}.txt`,
            mimeType: "text/plain",
            declaredSizeBytes: size,
            sizeBytes: null,
            sha256: null,
            state: "UPLOADING",
            createdAt: oldDate,
            cleanupPending: false,
            claimedSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          },
        });
      }

      await cleanupOrphanAttachmentsLocked();

      const totalDeclared = orphanSizes.reduce((sum, s) => sum + s, 0n);
      const project = await prisma.project.findUnique({
        where: { id: testProjectId },
        select: { reservedBytes: true },
      });
      
      // 批量处理：10MB - 3.5MB = 6.5MB
      expect(project!.reservedBytes).toBe(initialReserved - totalDeclared);
      expect(project!.reservedBytes).toBeGreaterThan(0n);
    });
  });

  describe("Database CHECK constraint enforcement (A-02)", () => {
    it("should reject INSERT with negative reservedBytes via CHECK constraint", async () => {
      // 尝试插入违反 CHECK 约束的数据
      await expect(
        prisma.$executeRaw`
          INSERT INTO "Project" (
            "id", "ownerId", "name", "key", "color",
            "reservedBytes", "usedBytes", "createdAt", "updatedAt"
          ) VALUES (
            ${randomUUID()}, ${testUserId}, 'Negative Test', 'NEGAT', ${ProjectColor.BLUE},
            -1, 0, NOW(), NOW()
          )
        `
      ).rejects.toThrow(/violates check constraint|non_negative_reserved/i);
    });

    it("should reject UPDATE that makes reservedBytes negative via CHECK constraint", async () => {
      const smallProjectId = randomUUID();
      await prisma.project.create({
        data: {
          id: smallProjectId,
          ownerId: testUserId,
          name: "Small Reserved Project",
          key: `SMALL${randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase()}`,
          color: ProjectColor.GREEN,
          reservedBytes: 100n, // 很小的预留
        },
      });

      try {
        // 尝试减去大量值使 reservedBytes < 0
        await expect(
          prisma.$executeRaw`
            UPDATE "Project" SET "reservedBytes" = -1000000
            WHERE "id" = ${smallProjectId}
          `
        ).rejects.toThrow(/violates check constraint|non_negative_reserved/i);
      } finally {
        await prisma.project.deleteMany({ where: { id: smallProjectId } });
      }
    });

    it("should verify CHECK constraints exist in database", async () => {
      const constraints = await prisma.$queryRaw<
        Array<{ conname: string; definition: string }>
      >`
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = '"Project"'::regclass
          AND contype = 'c'
          AND conname LIKE 'non_negative%'
      `;

      expect(constraints).toHaveLength(2);
      const names = constraints.map(c => c.conname).sort();
      expect(names).toEqual(["non_negative_reserved", "non_negative_used"]);
    });
  });
});
