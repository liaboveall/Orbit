import "server-only";
import { statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DomainError } from "@/server/http/errors";
import { MAX_ATTACHMENT_BYTES } from "@/server/modules/limits";

export const MAX_PROCESS_UPLOADS = 4;
export const MAX_PROCESS_DOWNLOADS = 8;
export const MIN_UPLOAD_FREE_BYTES = 64n * 1024n * 1024n + BigInt(MAX_PROCESS_UPLOADS * MAX_ATTACHMENT_BYTES);

/** Resource bound for one Node process; shared user quotas remain in PostgreSQL. */
export class TransferCapacity {
  private active = 0;
  private readonly users = new Map<string, number>();
  constructor(private readonly maximum: number, private readonly perUser: number) {}
  acquire(userId: string): (() => void) | null {
    const count = this.users.get(userId) ?? 0;
    if (this.active >= this.maximum || count >= this.perUser) return null;
    this.active++;
    this.users.set(userId, count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const remaining = this.users.get(userId)! - 1;
      if (remaining) this.users.set(userId, remaining); else this.users.delete(userId);
    };
  }
}

const state = globalThis as typeof globalThis & { orbitTransferCapacity?: { uploads: TransferCapacity; downloads: TransferCapacity } };
const capacity = state.orbitTransferCapacity ??= {
  uploads: new TransferCapacity(MAX_PROCESS_UPLOADS, 2),
  downloads: new TransferCapacity(MAX_PROCESS_DOWNLOADS, 2),
};
function busy() { return new DomainError("RATE_LIMITED", "当前文件传输较多，请稍后重试。", undefined, undefined, 1); }

export function acquireDownloadCapacity(userId: string): () => void {
  const release = capacity.downloads.acquire(userId);
  if (!release) throw busy();
  return release;
}

export async function acquireUploadCapacity(userId: string): Promise<() => void> {
  const release = capacity.uploads.acquire(userId);
  if (!release) throw busy();
  try {
    // Reserve enough headroom for every admitted file, without trusting declared body size.
    const disk = await statfs(tmpdir(), { bigint: true });
    if (disk.bavail * disk.bsize < MIN_UPLOAD_FREE_BYTES) throw new Error("Insufficient temporary space");
    return release;
  } catch {
    release();
    throw new DomainError("STORAGE_UNAVAILABLE", "上传暂不可用，请稍后重试。");
  }
}
