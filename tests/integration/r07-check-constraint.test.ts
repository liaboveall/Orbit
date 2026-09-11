import { afterAll, beforeAll, describe, expect, it } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { getEnv, parseEnv } from "@/server/env";
import { ProjectColor } from "@/generated/prisma/client";

/**
 * R07 CHECK 约束集成测试（数据库级约束验证）。
 *
 * 验证 Invitation 表的 CHECK 约束 `checked_accepted_at_and_by_id` 是否正确强制执行：
 * - acceptedAt 和 acceptedById 必须同时为 NULL 或同时非 NULL
 * - 违反约束的 INSERT/UPDATE 应抛出 PostgreSQL 错误
 *
 * 测试策略：直接执行 SQL 语句验证数据库约束，不通过应用层 API。
 */

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const _env = parseEnv(process.env as Record<string, string | undefined>);

process.env.APP_ENV = "test";
getEnv(true);

// 动态导入以使用测试数据库
const { prisma } = await import("@/server/db/prisma");

describe("R07 CHECK constraint enforcement", () => {
  let testProjectId: string;
  let testUserId: string;

  beforeAll(async () => {
    // 创建测试项目和用户
    testUserId = randomUUID();
    await prisma.user.create({
      data: {
        id: testUserId,
        email: `r07-test-${randomUUID()}@test.local`,
        name: "R07 Test User",
        emailVerified: true,
      },
    });

    testProjectId = randomUUID();
    await prisma.project.create({
      data: {
        id: testProjectId,
        name: "R07 Test Project",
        // Project.key 受 @db.VarChar(8) 与 CHECK `^[A-Z][A-Z0-9]{1,7}$` 双重约束，
        // 因此固定为 "R07" + 5 位十六进制大写（共 8 字符，首字符为字母）。
        // 曾用 Date.now().toString(36) 会产生 11 字符，导致 beforeAll 必然抛错、
        // 本套件 7 条测试全部被 skip（R07 约束实际从未被验证过）。
        key: `R07${randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase()}`,
        ownerId: testUserId,
        color: ProjectColor.BLUE,
      },
    });
  });

  afterAll(async () => {
    // 清理测试数据（按依赖顺序）
    await prisma.task.deleteMany({ where: { projectId: testProjectId } });
    await prisma.invitation.deleteMany({ where: { projectId: testProjectId } });
    await prisma.activityLog.deleteMany({ where: { projectId: testProjectId } });
    await prisma.projectMember.deleteMany({ where: { projectId: testProjectId } });
    await prisma.project.deleteMany({ where: { id: testProjectId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
    await prisma.$disconnect();
  });

  describe("Valid states (should succeed)", () => {
    it("allows both fields NULL (new invitation)", async () => {
      const invitationId = randomUUID();
      const tokenHash = `hash-${randomUUID()}`;
      
      const invitation = await prisma.invitation.create({
        data: {
          id: invitationId,
          tokenHash,
          projectId: testProjectId,
          createdById: testUserId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          // acceptedAt and acceptedById are both NULL by default
        },
      });

      expect(invitation.acceptedAt).toBeNull();
      expect(invitation.acceptedById).toBeNull();

      // Cleanup
      await prisma.invitation.delete({ where: { id: invitationId } });
    });

    it("allows both fields non-NULL (accepted invitation)", async () => {
      const invitationId = randomUUID();
      const tokenHash = `hash-${randomUUID()}`;
      const acceptedAt = new Date();
      
      const invitation = await prisma.invitation.create({
        data: {
          id: invitationId,
          tokenHash,
          projectId: testProjectId,
          createdById: testUserId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          acceptedAt,
          acceptedById: testUserId,
        },
      });

      expect(invitation.acceptedAt).toEqual(acceptedAt);
      expect(invitation.acceptedById).toBe(testUserId);

      // Cleanup
      await prisma.invitation.delete({ where: { id: invitationId } });
    });
  });

  describe("Invalid states (should fail with CHECK constraint violation)", () => {
    it("rejects acceptedAt non-NULL but acceptedById NULL", async () => {
      const invitationId = randomUUID();
      const tokenHash = `hash-${randomUUID()}`;
      
      // Try to create invitation with acceptedAt set but acceptedById NULL
      // This should violate the CHECK constraint
      await expect(
        prisma.$executeRaw`
          INSERT INTO "Invitation" (
            "id", "tokenHash", "projectId", "createdById", "expiresAt",
            "acceptedAt", "acceptedById"
          ) VALUES (
            ${invitationId}, ${tokenHash}, ${testProjectId}, ${testUserId},
            ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)},
            ${new Date()}, NULL
          )
        `
      ).rejects.toThrow(/violates check constraint|checked_accepted_at_and_by_id/i);
    });

    it("rejects acceptedAt NULL but acceptedById non-NULL", async () => {
      const invitationId = randomUUID();
      const tokenHash = `hash-${randomUUID()}`;
      
      // Try to create invitation with acceptedById set but acceptedAt NULL
      // This should violate the CHECK constraint
      await expect(
        prisma.$executeRaw`
          INSERT INTO "Invitation" (
            "id", "tokenHash", "projectId", "createdById", "expiresAt",
            "acceptedAt", "acceptedById"
          ) VALUES (
            ${invitationId}, ${tokenHash}, ${testProjectId}, ${testUserId},
            ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)},
            NULL, ${testUserId}
          )
        `
      ).rejects.toThrow(/violates check constraint|checked_accepted_at_and_by_id/i);
    });

    it("rejects UPDATE that sets acceptedAt to NULL when acceptedById is non-NULL", async () => {
      const invitationId = randomUUID();
      const tokenHash = `hash-${randomUUID()}`;
      
      // First create a valid invitation (both non-NULL)
      await prisma.invitation.create({
        data: {
          id: invitationId,
          tokenHash,
          projectId: testProjectId,
          createdById: testUserId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          acceptedAt: new Date(),
          acceptedById: testUserId,
        },
      });

      // Try to update to invalid state (set acceptedAt to NULL)
      await expect(
        prisma.$executeRaw`
          UPDATE "Invitation"
          SET "acceptedAt" = NULL
          WHERE "id" = ${invitationId}
        `
      ).rejects.toThrow(/violates check constraint|checked_accepted_at_and_by_id/i);

      // Cleanup
      await prisma.invitation.delete({ where: { id: invitationId } });
    });

    it("rejects UPDATE that sets acceptedById to NULL when acceptedAt is non-NULL", async () => {
      const invitationId = randomUUID();
      const tokenHash = `hash-${randomUUID()}`;
      
      // First create a valid invitation (both non-NULL)
      await prisma.invitation.create({
        data: {
          id: invitationId,
          tokenHash,
          projectId: testProjectId,
          createdById: testUserId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          acceptedAt: new Date(),
          acceptedById: testUserId,
        },
      });

      // Try to update to invalid state (set acceptedById to NULL)
      await expect(
        prisma.$executeRaw`
          UPDATE "Invitation"
          SET "acceptedById" = NULL
          WHERE "id" = ${invitationId}
        `
      ).rejects.toThrow(/violates check constraint|checked_accepted_at_and_by_id/i);

      // Cleanup
      await prisma.invitation.delete({ where: { id: invitationId } });
    });
  });

  describe("Constraint metadata", () => {
    it("verifies CHECK constraint exists in database", async () => {
      // contype 是 PostgreSQL 的 "char" 类型，Prisma $queryRaw 无法直接反序列化，
      // 必须显式 ::text；pg_get_constraintdef 也需别名才能按字段取值。
      const constraints = await prisma.$queryRaw<
        Array<{ conname: string; contype: string; definition: string }>
      >`
        SELECT conname, contype::text AS contype, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conname = 'checked_accepted_at_and_by_id'
          AND conrelid = '"Invitation"'::regclass
      `;

      expect(constraints).toHaveLength(1);
      const constraint = constraints[0]!;
      expect(constraint.contype).toBe("c");

      // 断言约束定义真的表达「两字段同为 NULL 或同为非 NULL」，
      // 而不只是「存在一条同名约束」——后者在约束被改写成任意条件时仍会通过。
      const definition = constraint.definition.replace(/\s+/g, " ");
      expect(definition).toMatch(/"acceptedAt" IS NULL/);
      expect(definition).toMatch(/"acceptedById" IS NULL/);
      expect(definition).toMatch(/"acceptedAt" IS NOT NULL/);
      expect(definition).toMatch(/"acceptedById" IS NOT NULL/);
    });
  });
});
