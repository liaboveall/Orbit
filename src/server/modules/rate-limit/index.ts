import "server-only";
import { MemoryRateLimiter } from "./memory";
type Options = { maxTokens?: number; refillIntervalMs?: number };
const state = globalThis as typeof globalThis & {
  __orbitRateLimiter__?: MemoryRateLimiter;
};
/** V1: one persistent Node instance; all API writes share this user bucket. */
export async function getRateLimiter(
  options?: Options,
): Promise<MemoryRateLimiter> {
  state.__orbitRateLimiter__ ??= new MemoryRateLimiter(options);
  return state.__orbitRateLimiter__;
}
export const RateLimiterFactory = {
  create: getRateLimiter,
  getInstance(): MemoryRateLimiter {
    if (!state.__orbitRateLimiter__)
      throw new Error("Rate limiter not initialized");
    return state.__orbitRateLimiter__;
  },
  resetInstance(): void {
    state.__orbitRateLimiter__?.stopCleanupInterval();
    delete state.__orbitRateLimiter__;
  },
};
export function getDefaultRateLimiter(): MemoryRateLimiter | null {
  return state.__orbitRateLimiter__ ?? null;
}
export async function initializeRateLimiter(options?: Options): Promise<void> {
  await getRateLimiter(options);
}
export { MemoryRateLimiter };
