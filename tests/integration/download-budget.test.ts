import { test, expect, vi } from "vitest";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import * as envModule from "@/server/env";
import { streamDownload, getStorageClient } from "@/server/modules/storage/client";

test("真实 S3 HTTP 流：正常字节、截断、取消、建连停滞和总预算均结束并释放连接", { timeout: 145_000 }, async () => {
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    if (request.url?.includes("headers-stall")) return;
    response.writeHead(200, { "content-type": "application/octet-stream", "content-length": "3" });
    response.flushHeaders();
    if (request.url?.includes("body-stall")) return;
    if (request.url?.includes("truncated")) {
      response.write(Buffer.from([1]));
      response.end();
    } else response.end(Buffer.from([1, 2, 3]));
  });
  server.on("connection", socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  const env = envModule.getEnv();
  const spy = vi.spyOn(envModule, "getEnv").mockReturnValue({ ...env, STORAGE_ENDPOINT: `http://127.0.0.1:${address.port}`, STORAGE_ACCESS_KEY_ID: "synthetic", STORAGE_SECRET_ACCESS_KEY: "synthetic", STORAGE_FORCE_PATH_STYLE: true });
  try {
    const normal = await streamDownload("normal");
    expect(normal.contentLength).toBe(3);
    expect(new Uint8Array(await new Response(normal.stream).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const truncated = await streamDownload("truncated");
    await expect(new Response(truncated.stream).arrayBuffer()).rejects.toThrow();
    const controller = new AbortController();
    const cancelled = await streamDownload("body-stall-cancel", controller.signal);
    const reading = new Response(cancelled.stream).arrayBuffer();
    controller.abort();
    await expect(reading).rejects.toThrow();
    const beganHeaders = Date.now();
    await expect(streamDownload("headers-stall")).rejects.toThrow();
    expect(Date.now() - beganHeaders).toBeLessThan(15_000);
    const beganBody = Date.now();
    const stalled = await streamDownload("body-stall-total");
    await expect(new Response(stalled.stream).arrayBuffer()).rejects.toThrow();
    expect(Date.now() - beganBody).toBeGreaterThanOrEqual(119_000);
    expect(Date.now() - beganBody).toBeLessThan(125_000);
    getStorageClient().destroy();
    await expect.poll(() => sockets.size).toBe(0);
  } finally {
    getStorageClient().destroy();
    spy.mockRestore();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
