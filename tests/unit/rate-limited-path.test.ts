import { describe, expect, it } from "vitest";
import { parseRateLimitedParams, rateLimitedPath, visiblePagePath } from "@/lib/rate-limited";

describe("页面读取超额说明页地址", () => {
  it("保留同源页面地址与筛选参数，去掉 RSC 内部参数", () => {
    expect(visiblePagePath("/app/projects/p/board?q=a&_rsc=abc")).toBe("/app/projects/p/board?q=a");
    expect(visiblePagePath("/app/today?_rsc=abc")).toBe("/app/today");
  });

  it("拒绝跨源与协议相对地址，回退工作台", () => {
    expect(visiblePagePath("https://evil.example/x")).toBe("/app/today");
    expect(visiblePagePath("//evil.example/x")).toBe("/app/today");
    expect(visiblePagePath(null)).toBe("/app/today");
  });

  it("构造与解析往返一致，等待秒数限定在 1—3600", () => {
    const path = rateLimitedPath("/app/projects/p/tasks?priority=HIGH&_rsc=x", 17);
    const query = Object.fromEntries(new URL(path, "http://orbit.test").searchParams);
    expect(path.startsWith("/rate-limited?")).toBe(true);
    expect(parseRateLimitedParams(query)).toEqual({ retryAfter: 17, returnTo: "/app/projects/p/tasks?priority=HIGH" });
    expect(parseRateLimitedParams({ retryAfter: "0", returnTo: "//evil" })).toEqual({ retryAfter: 60, returnTo: "/app/today" });
    expect(parseRateLimitedParams({ retryAfter: ["9999"], returnTo: ["/app/settings"] })).toEqual({ retryAfter: 60, returnTo: "/app/settings" });
  });
});
