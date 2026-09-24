import { describe, expect, it } from "vitest";
import { ErrorResponseSchema } from "@/contracts";
import * as catchAll from "@/app/api/v1/[...path]/route";

/**
 * OI-13：/api/v1/* 未知路径兜底必须返回 JSON 错误信封（而非 HTML 404 页）。
 * 既有路由不被抢占由真实服务器行为验证（见集成/E2E 套件）；这里验证信封契约。
 */
describe("API v1 未知路径 JSON 404 兜底", () => {
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

  for (const method of methods) {
    it(`${method} 未匹配路径返回 404 契约信封`, async () => {
      const request = new Request(`http://localhost/api/v1/definitely-not-a-route-${method.toLowerCase()}`, {
        method,
        headers: { "x-request-id": "probe-unknown-route" },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
      const response = await catchAll[method](request);
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const parsed = ErrorResponseSchema.safeParse(await response.json());
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe("NOT_FOUND");
        expect(parsed.data.meta.requestId).toBe("probe-unknown-route");
      }
    });
  }
});
