import "server-only";
import { buildErrorResponse } from "@/contracts";

/** Single-process M5 admission; PostgreSQL sharing remains part of M6. */
export class UploadGate {
  private readonly users = new Map<string, { attempts: number[]; active: number }>();

  acquire(userId: string, now = Date.now()): { allowed: true; release: () => void } | { allowed: false; retryAfter: number } {
    // Bound idle state without timers; active slots live until their finally block.
    for (const [id, entry] of this.users) {
      if (entry.active === 0 && (entry.attempts.at(-1) ?? 0) <= now - 60_000) this.users.delete(id);
    }
    const entry = this.users.get(userId) ?? { attempts: [], active: 0 };
    entry.attempts = entry.attempts.filter((at) => at > now - 60_000);
    this.users.set(userId, entry);
    if (entry.attempts.length >= 10) return { allowed: false, retryAfter: Math.max(1, Math.ceil((entry.attempts[0]! + 60_000 - now) / 1000)) };
    if (entry.active >= 2) return { allowed: false, retryAfter: 1 };
    entry.attempts.push(now);
    entry.active++;
    let released = false;
    return { allowed: true, release: () => { if (!released) { released = true; entry.active--; } } };
  }
}

const shared = globalThis as typeof globalThis & { orbitUploadGate?: UploadGate };
export function acquireUploadSlot(userId: string, requestId: string) {
  shared.orbitUploadGate ??= new UploadGate();
  const slot = shared.orbitUploadGate.acquire(userId);
  if (slot.allowed) return slot;
  return { allowed: false as const, response: Response.json(buildErrorResponse("RATE_LIMITED", "上传过于频繁或已有两个文件正在上传，请稍后重试。", { requestId }), {
    status: 429,
    headers: { "Retry-After": String(slot.retryAfter), "Cache-Control": "private, no-store", "x-request-id": requestId },
  }) };
}
