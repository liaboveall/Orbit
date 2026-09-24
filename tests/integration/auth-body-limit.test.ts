import { test, expect } from "vitest";
import { POST } from "@/app/api/auth/[...all]/route";
import { getEnv } from "@/server/env";

test.each([undefined, "10", "70000"])("真实认证路由：合法超限 JSON 返回 413（声明 %s）", async (declared) => {
  const bytes = new TextEncoder().encode(JSON.stringify({ email: "limit@orbit.test", password: "x".repeat(70000) }));
  const headers: Record<string, string> = { "content-type": "application/json", origin: getEnv().APP_URL };
  if (declared) headers["content-length"] = declared;
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
  const init: RequestInit & { duplex: "half" } = { method: "POST", headers, body, duplex: "half" };
  const response = await POST(new Request(new URL("/api/auth/sign-in/email", getEnv().APP_URL), init));
  expect(response.status).toBe(413);
  expect(response.headers.get("cache-control")).toContain("no-store");
});
