import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { TransferCapacity, acquireUploadCapacity, acquireDownloadCapacity, MIN_UPLOAD_FREE_BYTES } from "@/server/modules/attachments/transfer-capacity";
import { guardDownloadStream } from "@/server/modules/storage/download-stream";

vi.mock("node:fs/promises", async importOriginal => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, statfs: vi.fn(original.statfs) };
});

afterEach(() => vi.restoreAllMocks());

it("aggregate transfer capacity applies across users and duplicate release cannot over-admit", () => {
  const gate = new TransferCapacity(4, 2);
  const releases = [gate.acquire("a"), gate.acquire("a"), gate.acquire("b"), gate.acquire("c")];
  expect(releases.every(Boolean)).toBe(true);
  expect(gate.acquire("d")).toBeNull(); expect(gate.acquire("a")).toBeNull();
  releases[0]!(); releases[0]!();
  const next = gate.acquire("d"); expect(next).not.toBeNull(); expect(gate.acquire("e")).toBeNull();
  for (const release of releases) release!(); next!();
  expect(gate.acquire("a")).not.toBeNull();
});

it("low or unreadable temporary disk rejects uploads without leaking capacity", async () => {
  const actual = await fs.statfs(tmpdir(), { bigint: true });
  const probe = vi.mocked(fs.statfs).mockResolvedValue({ ...actual, bavail: 0n });
  for (let i = 0; i < 5; i++) await expect(acquireUploadCapacity("disk-user")).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  probe.mockRejectedValue(new Error("disk unavailable"));
  await expect(acquireUploadCapacity("disk-user")).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  probe.mockResolvedValue({ ...actual, bsize: 1n, bavail: MIN_UPLOAD_FREE_BYTES });
  const first = await acquireUploadCapacity("disk-user");
  const second = await acquireUploadCapacity("disk-user");
  try { await expect(acquireUploadCapacity("disk-user")).rejects.toMatchObject({ code: "RATE_LIMITED" }); }
  finally { first(); second(); }
});

it.each(["complete", "abort", "cancel", "error"])("download %s releases user capacity for a subsequent transfer", async mode => {
  const user = `download-${mode}`;
  const first = acquireDownloadCapacity(user), held = acquireDownloadCapacity(user);
  expect(() => acquireDownloadCapacity(user)).toThrow();
  const abort = new AbortController();
  const source = new ReadableStream<Uint8Array>({ start(controller) {
    if (mode === "complete") controller.close();
    if (mode === "error") controller.error(new Error("storage failed"));
  } });
  const stream = guardDownloadStream(source, null, abort.signal, first);
  try {
    if (mode === "abort") { abort.abort(); await expect(new Response(stream).arrayBuffer()).rejects.toThrow(); }
    else if (mode === "cancel") await stream.cancel();
    else if (mode === "error") await expect(new Response(stream).arrayBuffer()).rejects.toThrow();
    else await new Response(stream).arrayBuffer();
    const recovered = acquireDownloadCapacity(user); recovered();
  } finally { first(); held(); }
});
