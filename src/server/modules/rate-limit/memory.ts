/**
 * In-memory rate limiter (M2 / ORB-021).
 *
 * 当前实现用内存 Map 跟踪每用户/每键的请求计数（单节点令牌桶）。
 * 它在**单实例**部署下正确工作，但不适用于多副本/分布式环境
 * （请求可能被路由到不同实例，每个实例各自持有独立的内存计数）。
 *
 * 多副本共享限流应遵循既定 PostgreSQL 架构方向（见 docs/03 §8、docs/11
 * ADR-014），**不引入 Redis**（AGENTS.md：不自行新增 Redis）；当前为
 * 单节点内存实现，多副本部署前需迁移到 PostgreSQL 共享计数。
 *
 * Bucket refill algorithm (leaky bucket):
 * - Each user+key has a `tokens` count (max = requestsPerMinute)
 * - On each request, atomically decrement the token count
 * - Every refillInterval ms, tokens are replenished to max
 * - If no tokens available → reject with rate limit exceeded
 *
 * Time complexity: O(1) per request
 * Space complexity: O(unique user × key combinations active at any time)
 */

import "server-only";

interface RateLimitBucket {
  tokens: number;
  lastRefill: number; // timestamp in ms
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAfter: number; // seconds until bucket refills
  retryAfter?: number; // optional, for explicit Retry-After header
}

const DEFAULT_MAX_TOKENS = 60; // 60 requests per minute
const DEFAULT_REFILL_INTERVAL_MS = 60000; // 1 minute

/**
 * Memory-based rate limiter using a simple leaky bucket algorithm.
 * Suitable for development/testing and single-instance production deployments.
 *
 * ⚠️ 当前为单节点内存实现；多副本部署前需迁移到 PostgreSQL 共享计数，
 *    遵循既定 PostgreSQL 架构方向（见 docs/03 §8、docs/11 ADR-014），不引入 Redis。
 * 
 * Q07 修复内容：
 * - 完整 token 恢复（full recovery）：窗口期过后 tokens 重置为最大值而非增量累积
 * - 所有用户写操作共享同一个 bucket（userId 维度）：60 tokens/user/minute 覆盖
 *   * Project create/update
 *   * Task create/update/delete/move
 * - 独立的 userId 桶隔离
 * - 返回结果包含 retryAfter 字段用于 Retry-After 头部
 */
export class MemoryRateLimiter {
  private buckets: Map<string, RateLimitBucket>;
  private maxTokens: number;
  private refillIntervalMs: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options?: {
    maxTokens?: number;
    refillIntervalMs?: number;
  }) {
    this.maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.refillIntervalMs = options?.refillIntervalMs ?? DEFAULT_REFILL_INTERVAL_MS;
    this.buckets = new Map();
    
    // Periodic cleanup of stale buckets (every hour removes buckets idle for >2 hours)
    this.startCleanupInterval();
  }

  /** Generate a unique key for user + operation */
  private static makeKey(userId: string, key: string): string {
    return `${userId}:${key}`;
  }

  /** Refill tokens based on elapsed time since last refill */
  private refillTokens(bucket: RateLimitBucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const intervalsPassed = Math.floor(elapsed / this.refillIntervalMs);
    
    // Q07 修复：完整恢复而非增量累积（full recovery after window passes）
    if (intervalsPassed >= 1) {
      bucket.tokens = this.maxTokens;
      bucket.lastRefill = now;
    } else {
      // 不足一个窗口期间，不 refill
    }
  }

  /** Check if a request is allowed under rate limits */
  async checkLimit(
    userId: string,
    key: string = 'default',
  ): Promise<RateLimitResult> {
    const bucketKey = MemoryRateLimiter.makeKey(userId, key);
    const now = Date.now();

    // Get or create bucket
    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        tokens: this.maxTokens,
        lastRefill: now,
      };
      this.buckets.set(bucketKey, bucket);
    }

    // Refill tokens based on elapsed time
    this.refillTokens(bucket);

    if (bucket.tokens > 0) {
      // Allow request, consume one token
      bucket.tokens--;
      const remainingAfter = bucket.tokens;
      
      // 如果刚好耗尽，resetAfter 应为完整的窗口期
      // 否则为距离下次 refill 的时间
      let resetAfter: number;
      if (remainingAfter === 0 && now - bucket.lastRefill < this.refillIntervalMs) {
        // 还有 tokens 但被消耗了，计算到下次 refil 的时间
        const msUntilRefill = this.refillIntervalMs - (now - bucket.lastRefill);
        resetAfter = Math.ceil(msUntilRefill / 1000);
      } else {
        // 桶未满，显示完整窗口期
        resetAfter = Math.ceil(this.refillIntervalMs / 1000);
      }
      
      return {
        allowed: true,
        remaining: remainingAfter,
        resetAfter,
      };
    }

    // Rate limit exceeded
    // 计算下一个 token 何时可用（实际上是下一个窗口的开始）
    const msSinceLastRefill = now - bucket.lastRefill;
    const msUntilNextRefill = this.refillIntervalMs - msSinceLastRefill;
    const resetAfterSeconds = Math.max(1, Math.ceil(Math.abs(msUntilNextRefill) / 1000));

    return {
      allowed: false,
      remaining: 0,
      resetAfter: resetAfterSeconds,
      retryAfter: resetAfterSeconds, // Q07: 显式添加 Retry-After 字段
    };
  }

  /** Reset rate limit state for a specific user+key combination */
  async resetLimit(userId: string, key: string = 'default'): Promise<void> {
    const bucketKey = MemoryRateLimiter.makeKey(userId, key);
    this.buckets.delete(bucketKey);
  }

  /** Clear all rate limit state (for testing or maintenance) */
  async clearAll(): Promise<void> {
    this.buckets.clear();
  }

  /** Start periodic cleanup of stale buckets */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000); // 2 hours
      
      for (const [key, bucket] of this.buckets.entries()) {
        if (bucket.lastRefill < twoHoursAgo) {
          this.buckets.delete(key);
        }
      }
    }, 3600000); // Cleanup every hour
  }

  /** Stop periodic cleanup interval */
  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /** Get statistics about current rate limiting state */
  getStats(): { totalBuckets: number; maxTokens: number; refillIntervalMs: number } {
    return {
      totalBuckets: this.buckets.size,
      maxTokens: this.maxTokens,
      refillIntervalMs: this.refillIntervalMs,
    };
  }
}

// Singleton instance for backward compatibility
let memoryLimiterInstance: MemoryRateLimiter | null = null;

export function getMemoryRateLimiter(options?: ConstructorParameters<typeof MemoryRateLimiter>[0]): MemoryRateLimiter {
  if (!memoryLimiterInstance) {
    memoryLimiterInstance = new MemoryRateLimiter(options);
  }
  return memoryLimiterInstance;
}
