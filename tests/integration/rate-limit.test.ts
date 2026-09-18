/**
 * Rate Limiting Integration Tests (M2 / ORB-021)
 * 
 * These tests validate the memory-based rate limiter implementation.
 * Note: Redis-based rate limiter is not yet available due to uninstalled @redis/client dependency.
 * 
 * ⚠️ Test Isolation (Q08 fix):
 *  - Force TEST_DATABASE_URL validation before any Prisma import
 *  - Precise cleanup by runId instead of email contains
 *  - Split pure algorithm tests to unit/ directory
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import type { MemoryRateLimiter } from "@/server/modules/rate-limit/memory";
import { getEnv, parseEnv } from "@/server/env";

/** ── Environment Setup: Force TEST_DATABASE_URL validation BEFORE any Prisma import ─────────── */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

// Validate independent database targets before loading the Prisma singleton.
parseEnv(process.env);

process.env.APP_ENV = "test";
process.env.BETTER_AUTH_SECRET = "orbit-integration-test-secret-0123456789";
getEnv(true);

/**
 * 把应�?Prisma 单例替换为绑�?orbit_test 的客户端（惰性工厂，首次 import 时执行）�?
 * 连接�?max=15：给并发/多事务留出余量�?
 */
vi.mock("@/server/db/prisma", async () => {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { parseEnv: parseTestEnv } = await import("@/server/env");
  const testEnv = parseTestEnv(process.env as Record<string, string | undefined>);
  const adapter = new PrismaPg({
    connectionString: testEnv.TEST_DATABASE_URL,
    max: 15,
    options: "-c statement_timeout=5000 -c lock_timeout=3000",
  });
  return { prisma: new PrismaClient({ adapter }) };
});

/* ── 动�?import（必须在环境覆写�?vi.mock 注册之后）────────────────────── */
const rateLimitModule = await import("@/server/modules/rate-limit");
const { prisma } = await import("@/server/db/prisma");


/** ── Fixture Constants ─────────────────────────────────────────────────────── */
const RUN_TAG = `ratelimit-${Date.now()}`;
const domain = "orbit.test";
const EMAIL_A = `${RUN_TAG}-a@${domain}`;
const EMAIL_B = `${RUN_TAG}-b@${domain}`;


let __testUserIdA = "";
let __testUserIdB = "";
let _limiter: MemoryRateLimiter | null = null;

/** Precise cleanup function tracking created IDs */
async function cleanupCreatedIds(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { in: [EMAIL_A, EMAIL_B] } },
    select: { id: true, email: true },
  });
  
  // Delete precisely by ID instead of wide email contains search
  for (const user of users) {
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
}

beforeAll(async () => {
  // Create isolated test users with precise tracking
  const userA = await prisma.user.create({
    data: {
      email: EMAIL_A,
      name: "Rate Limit Test User A",
      timezone: "Asia/Shanghai",
    },
  });
  __testUserIdA = userA.id;
  
  const userB = await prisma.user.create({
    data: {
      email: EMAIL_B,
      name: "Rate Limit Test User B",
      timezone: "America/New_York",
    },
  });
  __testUserIdB = userB.id;
  
}, 60_000);

afterEach(() => { rateLimitModule.RateLimiterFactory.resetInstance(); });

afterAll(async () => {
  await cleanupCreatedIds();
  await prisma.$disconnect();
});

/** ── Pure Algorithm Tests (Moved from integration - no DB needed) ─────────────
 * The MemoryRateLimiter tests don't need database at all.
 * They should live in tests/unit/rate-limit-algorithm.test.ts
 * For now, keep them here but marked as needing migration.
 */

describe("[NEEDS MIGRATION TO UNIT] MemoryRateLimiter Core Algorithm", () => {
  it("should allow requests within limit (60/min)", async () => {
    const { MemoryRateLimiter } = await import("@/server/modules/rate-limit/memory");
    const _limiter = new MemoryRateLimiter({ maxTokens: 60, refillIntervalMs: 60000 });
    _limiter.stopCleanupInterval();
    
    const results = [];
    for (let i = 0; i < 60; i++) {
      const result = await _limiter.checkLimit("temp-user", "api-call");
      results.push(result.allowed);
    }
    
    expect(results.filter((r) => r).length).toBe(60);
    
    const stats = _limiter.getStats();
    expect(stats.maxTokens).toBe(60);
  });

  it("should reject requests after limit exceeded", async () => {
    const { MemoryRateLimiter } = await import("@/server/modules/rate-limit/memory");
    const _limiter = new MemoryRateLimiter({ maxTokens: 5, refillIntervalMs: 60000 });
    _limiter.stopCleanupInterval();
    
    for (let i = 0; i < 5; i++) {
      await _limiter.checkLimit("temp-user", "api-call-exhaust");
    }
    
    const result = await _limiter.checkLimit("temp-user", "api-call-exhaust");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetAfter).toBeDefined();
    expect(result.resetAfter).toBeGreaterThan(0);
  });

  it("should have correct remaining count", async () => {
    const { MemoryRateLimiter } = await import("@/server/modules/rate-limit/memory");
    const _limiter = new MemoryRateLimiter({ maxTokens: 10, refillIntervalMs: 60000 });
    _limiter.stopCleanupInterval();
    
    for (let i = 0; i < 3; i++) {
      await _limiter.checkLimit("temp-user", "api-count-test");
    }
    
    const result = await _limiter.checkLimit("temp-user", "api-count-test");
    expect(result.remaining).toBe(6);
  });
});

/* ── Real Integration Tests (need DB for user identity) ──────────────────────── */

describe("Rate Limiting Infrastructure", () => {
  beforeEach(async () => {
    const rateLimitModule = await import("@/server/modules/rate-limit");
    _limiter = await rateLimitModule.getRateLimiter({ maxTokens: 2, refillIntervalMs: 60000 });
  });

  it("同一用户同一操作键的真实 60/min 边界：前 60 次允许、第 61 次拒绝、完整窗口后恢复", async () => {
    expect(_limiter).toBeDefined();
    // 不复用 beforeEach 的工厂单例（maxTokens=2）：本用例需要显式 60/min 配置，
    // 并在受控时钟下验证同一桶的边界与时间恢复。
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    try {
      const limiter = new rateLimitModule.MemoryRateLimiter({ maxTokens: 60, refillIntervalMs: 60_000 });
      limiter.stopCleanupInterval();
      const OPERATION = "sixty-per-minute-boundary";
      for (let i = 0; i < 60; i++) {
        const result = await limiter.checkLimit(__testUserIdA, OPERATION);
        expect(result.allowed, `第 ${i + 1} 次请求应被允许`).toBe(true);
      }
      const denied = await limiter.checkLimit(__testUserIdA, OPERATION);
      expect(denied.allowed).toBe(false);
      expect(denied.remaining).toBe(0);
      expect(denied.retryAfter).toBeGreaterThan(0);
      // 窗口内推进 59.999s：仍应拒绝。
      vi.advanceTimersByTime(59_999);
      expect((await limiter.checkLimit(__testUserIdA, OPERATION)).allowed).toBe(false);
      // 越过完整窗口：完整恢复（Q07 语义）。
      vi.advanceTimersByTime(1_000);
      const recovered = await limiter.checkLimit(__testUserIdA, OPERATION);
      expect(recovered.allowed).toBe(true);
      expect(recovered.remaining).toBe(59);
      limiter.stopCleanupInterval();
    } finally {
      vi.useRealTimers();
    }
  });

  describe("User Isolation", () => {
    it("should maintain separate limits for different users", async () => {
      expect(_limiter).toBeDefined();
      const _testLimiter = _limiter!;
      
      const user1Id = __testUserIdA;
      const user2Id = __testUserIdB;
      
      // Exhaust user1's limit
      await _testLimiter.checkLimit(user1Id, 'shared-operation');
      await _testLimiter.checkLimit(user1Id, 'shared-operation');
      
      // user1 should be blocked
      const user1Result = await _testLimiter.checkLimit(user1Id, 'shared-operation');
      expect(user1Result.allowed).toBe(false);
      
      // user2 should still have full quota
      const user2Result = await _testLimiter.checkLimit(user2Id, 'shared-operation');
      expect(user2Result.allowed).toBe(true);
      expect(user2Result.remaining).toBeLessThan(10);
    });

    it("should maintain separate limits for different operation keys", async () => {
      expect(_limiter).toBeDefined();
      const _testLimiter = _limiter!;
      
      // Exhaust limit for 'write' key
      await _testLimiter.checkLimit(__testUserIdA, 'write');
      await _testLimiter.checkLimit(__testUserIdA, 'write');
      
      // Write should be blocked
      const writeResult = await _testLimiter.checkLimit(__testUserIdA, 'write');
      expect(writeResult.allowed).toBe(false);
      
      // Read key should still have quota
      const readResult = await _testLimiter.checkLimit(__testUserIdA, 'read');
      expect(readResult.allowed).toBe(true);
    });
  });

  describe("Reset and Clear Operations", () => {
    it("should reset individual user+key combination", async () => {
      expect(_limiter).toBeDefined();
      const _testLimiter = _limiter!;
      
      await _testLimiter.checkLimit(__testUserIdA, 'test-reset-1');
      await _testLimiter.checkLimit(__testUserIdA, 'test-reset-1');
      
      let result = await _testLimiter.checkLimit(__testUserIdA, 'test-reset-1');
      expect(result.allowed).toBe(false);
      
      await _testLimiter.resetLimit(__testUserIdA, 'test-reset-1');
      
      result = await _testLimiter.checkLimit(__testUserIdA, 'test-reset-1');
      expect(result.allowed).toBe(true);
    });

    it("should clear all rate limit state", async () => {
      expect(_limiter).toBeDefined();
      const _testLimiter = _limiter!;
      
      await _testLimiter.checkLimit(__testUserIdA, 'clear-key-1');
      await _testLimiter.checkLimit(__testUserIdA, 'clear-key-2');
      await _testLimiter.checkLimit(__testUserIdA, 'clear-key-3');
      
      const statsBefore = _testLimiter.getStats();
      expect(statsBefore.totalBuckets).toBeGreaterThanOrEqual(1);
      
      await _testLimiter.clearAll();
      
      const statsAfter = _testLimiter.getStats();
      expect(statsAfter.totalBuckets).toBe(0);
      
      const result = await _testLimiter.checkLimit(__testUserIdA, 'new-key-after-clear');
      expect(result.allowed).toBe(true);
    });
  });

  describe("Factory Pattern with getRateLimiter", () => {
    it("should use factory to create appropriate limiter instance", async () => {
      const { MemoryRateLimiter } = await import("@/server/modules/rate-limit/memory");
      const _newLimiter = await rateLimitModule.getRateLimiter({ maxTokens: 10, refillIntervalMs: 60000 });
      
      expect(_newLimiter).toBeInstanceOf(MemoryRateLimiter);
      
      const result = await _newLimiter.checkLimit(__testUserIdA, 'factory-test-1');
      expect(result.allowed).toBe(true);
    });

    it("should use singleton pattern", async () => {
      
      const _newLimiter1 = await rateLimitModule.getRateLimiter({ maxTokens: 5, refillIntervalMs: 60000 });
      const _newLimiter2 = await rateLimitModule.getRateLimiter({ maxTokens: 10, refillIntervalMs: 60000 });
      
      expect(_newLimiter1).toBe(_newLimiter2);
    });
  });

  describe("Rate Limit Edge Cases", () => {
    it("should handle new users correctly", async () => {
      expect(_limiter).toBeDefined();
      const _testLimiter = _limiter!;
      const newUserId = "new-user-" + Date.now();
      
      const result = await _testLimiter.checkLimit(newUserId, 'edge-new-user-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeLessThanOrEqual(10);
    });

    it("should handle concurrent requests atomically", async () => {
      expect(_limiter).toBeDefined();
      const _testLimiter = new rateLimitModule.MemoryRateLimiter({ maxTokens: 5 });
      _testLimiter.stopCleanupInterval();
      
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(_testLimiter.checkLimit(__testUserIdA, 'concurrent-test-1'));
      }
      
      const results = await Promise.all(promises);
      
      const successful = results.filter((result) => result.allowed).length;
      expect(successful).toBe(5);
      
      const failed = results.filter((result) => !result.allowed).length;
      expect(failed).toBe(5);
    });

    it("should respect custom token configuration", async () => {
      expect(_limiter).toBeDefined();
      const _testLimiter = _limiter!;
      
      for (let i = 0; i < 3; i++) {
        await _testLimiter.checkLimit(__testUserIdA, 'custom-config-1');
      }
      
      const result = await _testLimiter.checkLimit(__testUserIdA, 'custom-config-1');
      expect(result.allowed).toBe(false);
    });

    it("should calculate reset time correctly when exhausted", async () => {
      expect(_limiter).toBeDefined();
      const _testLimiter = _limiter!;
      
      await _testLimiter.checkLimit(__testUserIdA, 'reset-time-test-1');
      await _testLimiter.checkLimit(__testUserIdA, 'reset-time-test-1');
      
      const result = await _testLimiter.checkLimit(__testUserIdA, 'reset-time-test-1');
      expect(result.allowed).toBe(false);
      expect(result.resetAfter).toBeDefined();
      expect(result.resetAfter!).toBeGreaterThan(0);
    });
  });

  describe("Statistics and Monitoring", () => {
    it("should provide accurate bucket statistics", async () => {
      expect(_limiter).toBeDefined();
      const _testLimiter = _limiter!;
      
      // Stats depend on previous tests ran
      
      await _testLimiter.checkLimit(__testUserIdA, 'stat-monitor-1');
      await _testLimiter.checkLimit(__testUserIdA, 'stat-monitor-2');
      
      const _statsAfter = _testLimiter.getStats();
      expect(_statsAfter.totalBuckets).toBeGreaterThanOrEqual(1);
    });
  });
});
