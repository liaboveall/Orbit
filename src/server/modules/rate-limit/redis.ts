import "server-only";
import { MemoryRateLimiter } from "./memory";
/** Compatibility only: persistent local fallback, NOT a distributed implementation.
 * The V1 factory deliberately never selects this adapter. */
export class RedisRateLimiter extends MemoryRateLimiter {
  constructor(options?: {
    maxTokens?: number;
    refillIntervalMs?: number;
    redisUrl?: string;
  }) {
    super(options);
  }
  async disconnect(): Promise<void> {
    this.stopCleanupInterval();
  }
}
let instance: RedisRateLimiter | undefined;
export function getRedisRateLimiter(
  options?: ConstructorParameters<typeof RedisRateLimiter>[0],
): RedisRateLimiter {
  instance ??= new RedisRateLimiter(options);
  return instance;
}
