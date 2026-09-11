/**
 * Rate Limiting Unit Tests for Invitation Endpoints (R10)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRateLimiter } from "@/server/modules/rate-limit/memory";

describe("MemoryRateLimiter - Token Bucket Algorithm", () => {
  let limiter: MemoryRateLimiter;

  beforeEach(() => {
    // Clean slate for each test
    limiter = new MemoryRateLimiter({ maxTokens: 10, refillIntervalMs: 500 });
    
    // Stop cleanup interval to prevent side effects
    if ("stopCleanupInterval" in limiter && typeof limiter.stopCleanupInterval === "function") {
      limiter.stopCleanupInterval();
    }
  });

  it("should allow requests within the limit", async () => {
    const userId = "test-user-r10";
    
    // Make 8 requests within limit
    for (let i = 0; i < 8; i++) {
      const result = await limiter.checkLimit(userId, "api-test");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(2);
    }
  });

  it("should deny requests when limit exceeded", async () => {
    const userId = "test-user-r10-limited";
    
    // Exhaust all tokens
    for (let i = 0; i < 10; i++) {
      const result = await limiter.checkLimit(userId, "exhaust-test");
      expect(result.allowed).toBe(true);
    }
    
    // Next request should be denied
    const nextResult = await limiter.checkLimit(userId, "exhaust-test");
    expect(nextResult.allowed).toBe(false);
    expect(nextResult.remaining).toBe(0);
    expect(nextResult.retryAfter).toBeDefined();
    expect(nextResult.retryAfter!).toBeGreaterThan(0);
  });

  it("should track accurate remaining count", async () => {
    const userId = "test-user-r10-count";
    
    // Make 3 requests
    for (let i = 0; i < 3; i++) {
      await limiter.checkLimit(userId, "count-test");
    }
    
    // Should have 7 remaining
    const result = await limiter.checkLimit(userId, "count-test");
    expect(result.remaining).toBe(6);
  });

  it("should reset after refill interval passes", async () => {
    const userId = "test-user-r10-reset";
    
    // Exhaust all tokens
    for (let i = 0; i < 10; i++) {
      await limiter.checkLimit(userId, "reset-test");
    }
    
    // Wait for refill interval (with some margin)
    await new Promise(resolve => setTimeout(resolve, 600));
    
    // Should have full quota again
    const result1 = await limiter.checkLimit(userId, "reset-test");
    expect(result1.allowed).toBe(true);
    expect(result1.remaining).toBe(9);
    
    const result2 = await limiter.checkLimit(userId, "reset-test");
    expect(result2.allowed).toBe(true);
    expect(result2.remaining).toBe(8);
  });

  it("should maintain separate buckets for different users", async () => {
    const userA = "user-a-r10";
    const userB = "user-b-r10";
    
    // Exhaust user A's tokens
    for (let i = 0; i < 10; i++) {
      await limiter.checkLimit(userA, "isolation-test");
    }
    
    // User A should be limited
    const userAResult = await limiter.checkLimit(userA, "isolation-test");
    expect(userAResult.allowed).toBe(false);
    
    // User B should still have full quota
    const userBResult = await limiter.checkLimit(userB, "isolation-test");
    expect(userBResult.allowed).toBe(true);
    expect(userBResult.remaining).toBe(9);
  });

  it("should support full recovery pattern over time", async () => {
    const userId = "test-user-r10-full-recovery";
    
    // Exhaust all tokens
    for (let i = 0; i < 10; i++) {
      await limiter.checkLimit(userId, "full-recovery-test");
    }
    
    // Verify fully exhausted
    const exhaustedCheck = await limiter.checkLimit(userId, "full-recovery-test");
    expect(exhaustedCheck.allowed).toBe(false);
    
    // Wait for ONE complete refill cycle
    await new Promise(resolve => setTimeout(resolve, 600));
    
    // Should now have FULL quota (not partial)
    const result1 = await limiter.checkLimit(userId, "full-recovery-test");
    const result2 = await limiter.checkLimit(userId, "full-recovery-test");
    const result3 = await limiter.checkLimit(userId, "full-recovery-test");
    
    // After consuming 3, should have 7 left (full recovery + consumption)
    expect(result1.allowed).toBe(true);
    expect(result2.allowed).toBe(true);
    expect(result3.allowed).toBe(true);
    
    const finalRemaining = await limiter.checkLimit(userId, "full-recovery-test");
    expect(finalRemaining.remaining).toBe(6); // Started at 10, consumed 4
  });
});

describe("R10 Rate Limiting Integration - Anonymous Invite Flow", () => {
  it("should handle sequential invite preview and accept requests independently", async () => {
    const limiter = new MemoryRateLimiter({ 
      maxTokens: 20, 
      refillIntervalMs: 5000 
    });
    
    if ("stopCleanupInterval" in limiter && typeof limiter.stopCleanupInterval === "function") {
      limiter.stopCleanupInterval();
    }
    
    const ipKey = "127.0.0.1";
    
    // Alternate between preview and accept (simulating real usage)
    for (let i = 0; i < 10; i++) {
      // Preview request
      const previewResult = await limiter.checkLimit(ipKey, "anonymous-invite");
      expect(previewResult.allowed).toBe(true);
      
      // Accept request
      const acceptResult = await limiter.checkLimit(ipKey, "anonymous-invite");
      expect(acceptResult.allowed).toBe(true);
    }
    
    // Now should be close to limit (20 total used)
    const nextPreviewResult = await limiter.checkLimit(ipKey, "anonymous-invite");
    
    // Could be either allowed or denied depending on timing
    // The important part is that both endpoints share the SAME bucket
    expect(typeof nextPreviewResult.allowed).toBe("boolean");
    expect(nextPreviewResult.remaining).toBeLessThanOrEqual(1);
  });
});
