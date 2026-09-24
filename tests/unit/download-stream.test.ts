import { test, expect, vi } from "vitest";
import { guardDownloadStream } from "@/server/modules/storage/download-stream";

test("下载保持字节和背压，完成时释放预算", async () => {
  const release = vi.fn();
  const bytes = new Uint8Array([1, 2, 3]);
  const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
  const result = guardDownloadStream(source, 3, new AbortController().signal, release);
  expect(new Uint8Array(await new Response(result).arrayBuffer())).toEqual(bytes);
  expect(release).toHaveBeenCalledTimes(1);
});

test.each([2, 4])("下载长度不一致 %s 被拒绝且释放预算", async length => {
  const release = vi.fn();
  const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(3)); c.close(); } });
  const result = guardDownloadStream(source, length, new AbortController().signal, release);
  await expect(new Response(result).arrayBuffer()).rejects.toThrow("length mismatch");
  expect(release).toHaveBeenCalledTimes(1);
});

test("预算/请求 abort 结束停滞流并取消源，consumer cancel 也释放资源", async () => {
  for (const mode of ["abort", "cancel"]) {
    const controller = new AbortController(), release = vi.fn(), cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>({ cancel });
    const stream = guardDownloadStream(source, null, controller.signal, release);
    const reader = stream.getReader(), pending = reader.read();
    if (mode === "abort") {
      controller.abort();
      await expect(pending).rejects.toThrow("aborted");
    } else { await reader.cancel(); await pending; }
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  }
});
