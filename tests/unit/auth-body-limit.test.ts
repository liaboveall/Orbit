import { describe, expect, it } from "vitest";
import { AUTH_BODY_LIMIT_BYTES, withAuthGuards } from "@/server/auth/body-limit";

/**
 * 认证请求体预算（D4 修复验收，docs/08 §3）。
 *
 * 覆盖：声明 Content-Length 超限 → 不调用 handler 直接 413；无 Content-Length 的
 * chunked 超限 → 计数流按真实字节数拒绝；伪造（声明偏小）同样被真实字节数拦截；
 * 合法请求原样透传（body 完整可读）；GET 无 body 透传。均不产生无界副本。
 */

const GUARDED = (handler: (request: Request) => Promise<Response>) => withAuthGuards(handler);

/** 构造 chunked（无 Content-Length）请求：逐块发送指定总量的字节。 */
function chunkedRequest(totalBytes: number, chunkSize = 8 * 1024): Request {
  const bytes = new TextEncoder().encode(JSON.stringify("x".repeat(totalBytes - 2)));
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: new Headers({ "content-type": "application/json" }),
    body: stream,
    duplex: "half",
  };
  return new Request("https://orbit.test/api/auth/sign-up/email", init);
}

/** 声明 Content-Length 但真实发送更多字节（伪造声明）。 */
function spoofedLengthRequest(declared: number, actual: number): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify("x".repeat(actual - 2))));
      controller.close();
    },
  });
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      "content-length": String(declared),
    }),
    body: stream,
    duplex: "half",
  };
  return new Request("https://orbit.test/api/auth/sign-up/email", init);
}

describe("认证请求体预算（D4）", () => {
  it("客户端取消正在读取的请求时取消源流，且不调用 handler", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const init: RequestInit & { duplex: "half" } = { method: "POST", body, signal: controller.signal, duplex: "half" };
    const pending = GUARDED(async () => { throw Error("handler must not run"); })(new Request("https://orbit.test/api/auth/sign-in/email", init));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toBe(true);
  });

  it("超限后停止读取，即使源的 cancel 永不完成也立即返回 413", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) { pulls++; c.enqueue(new Uint8Array(8192)); },
      cancel() { cancelled = true; return new Promise<void>(() => undefined); },
    }, { highWaterMark: 0 });
    const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half" };
    const response = await GUARDED(async () => { throw Error("handler must not run"); })(new Request("https://orbit.test/api/auth/sign-in/email", init));
    expect(response.status).toBe(413);
    expect(pulls).toBe(9);
    expect(cancelled).toBe(true);
  });
  it("声明 Content-Length 超限 → 413，handler 不被调用（不读任何字节）", async () => {
    let handlerCalled = false;
    const response = await GUARDED(async () => {
      handlerCalled = true;
      return new Response("should not reach");
    })(
      new Request("https://orbit.test/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-length": String(AUTH_BODY_LIMIT_BYTES + 1) },
        body: JSON.stringify({ email: "a@b.c" }),
      }),
    );
    expect(handlerCalled).toBe(false);
    expect(response.status).toBe(413);
  });

  it("无 Content-Length 的 chunked 超限 → 流被销毁，读取方失败而非全量入内存", async () => {
    const response = await GUARDED(async (request) => {
      await request.json();
      throw new Error("Oversized body reached handler");
    })(chunkedRequest(AUTH_BODY_LIMIT_BYTES + 1));
    expect(response.status).toBe(413);
  });

  it("伪造 Content-Length（声明小、实际大）→ 按真实字节数拒绝", async () => {
    const response = await GUARDED(async (request) => {
      await request.json();
      throw new Error("Oversized body reached handler");
    })(spoofedLengthRequest(1024, AUTH_BODY_LIMIT_BYTES + 1));
    expect(response.status).toBe(413);
  });

  it("合法认证载荷完整透传：json() 返回原文（回调/登录不破坏）", async () => {
    const payload = JSON.stringify({
      email: "user@orbit.test",
      password: "p".repeat(72),
      name: "测试用户",
    });
    const response = await GUARDED(async (request) => {
      const body = (await request.json()) as { name: string };
      return new Response(JSON.stringify({ seen: body.name }));
    })(
      new Request("https://orbit.test/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ seen: "测试用户" });
  });

  it("GET 无 body → 原请求透传（不包装）", async () => {
    const request = new Request("https://orbit.test/api/auth/get-session");
    const response = await GUARDED(async (req) => new Response(String(req.body === null)))(
      request,
    );
    expect(await response.text()).toBe("true");
  });
});
