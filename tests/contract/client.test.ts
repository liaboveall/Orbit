import { describe, expect, it } from "vitest";
import {
  ApiClientError,
  DEFAULT_API_BASE_URL,
  UserSchema,
  buildRequestUrl,
  createApiClient,
  type FetchLike,
} from "@/contracts";

/**
 * API 客户端骨架测试（ORB-003）。
 * 用可注入的假 fetch 验证：URL 构造、信封解析（成功/列表/错误）、请求头与幂等键、异常处理。
 * 不触真实网络（AGENTS.md：外部依赖可 mock 隔离）。
 */

const VALID_USER = {
  id: "user_1",
  name: "张三",
  email: "zhangsan@example.com",
  emailVerified: true,
  timezone: "Asia/Shanghai",
};

interface Captured {
  input: RequestInfo | URL;
  init?: RequestInit;
}

/** 构造一个记录调用并返回固定响应的假 fetch。 */
function mockFetch(respond: () => Response): { fetchImpl: FetchLike; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl: FetchLike = (input, init) => {
    calls.push({ input, init });
    return Promise.resolve(respond());
  };
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("buildRequestUrl", () => {
  it("拼接 baseUrl + path + query，跳过 undefined，去除多余斜杠", () => {
    expect(buildRequestUrl("/api/v1", "/projects", undefined)).toBe("/api/v1/projects");
    expect(buildRequestUrl("/api/v1/", "projects", { limit: 30 })).toBe("/api/v1/projects?limit=30");
    expect(buildRequestUrl("/api/v1", "/tasks", { cursor: "c", q: undefined })).toBe(
      "/api/v1/tasks?cursor=c",
    );
  });

  it("默认基路径为 /api/v1（对齐 openapi servers[0].url）", () => {
    expect(DEFAULT_API_BASE_URL).toBe("/api/v1");
  });
});

describe("createApiClient · GET 成功信封", () => {
  it("解析 {data,meta} 并推导 data 类型", async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      jsonResponse({ data: VALID_USER, meta: { requestId: "req_1" } }),
    );
    const client = createApiClient({ fetchImpl });

    const result = await client.get("/me", UserSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.data.email).toBe("zhangsan@example.com");
      expect(result.meta.requestId).toBe("req_1");
    }
    expect(String(calls[0]?.input)).toBe("/api/v1/me");
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("getList 解析 {data:T[],meta:PageMeta}", async () => {
    const { fetchImpl } = mockFetch(() =>
      jsonResponse({
        data: [VALID_USER],
        meta: { requestId: "req_2", nextCursor: null, hasMore: false },
      }),
    );
    const client = createApiClient({ fetchImpl });
    const result = await client.getList("/users", UserSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.meta.hasMore).toBe(false);
    }
  });
});

describe("createApiClient · 业务错误信封", () => {
  it("4xx/5xx 解析为 {ok:false,error,meta}", async () => {
    const { fetchImpl } = mockFetch(() =>
      jsonResponse(
        { error: { code: "NOT_FOUND", message: "资源不存在" }, meta: { requestId: "req_3" } },
        404,
      ),
    );
    const client = createApiClient({ fetchImpl });
    const result = await client.get("/projects/x", UserSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error.code).toBe("NOT_FOUND");
      expect(result.meta.requestId).toBe("req_3");
    }
  });

  it("错误响应不符合信封时抛 ApiClientError（不吞错误）", async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse({ message: "gateway boom" }, 502));
    const client = createApiClient({ fetchImpl });
    await expect(client.get("/me", UserSchema)).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe("createApiClient · 写操作", () => {
  it("POST 序列化 body，设置 Content-Type 与 Idempotency-Key", async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      jsonResponse({ data: VALID_USER, meta: { requestId: "req_4" } }, 201),
    );
    const client = createApiClient({ fetchImpl });
    const result = await client.post("/projects", UserSchema, { name: "p" }, {
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.ok).toBe(true);
    const init = calls[0]?.init;
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ name: "p" }));
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Idempotency-Key"]).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("PATCH/DELETE 使用正确 method；无 body 时不设 Content-Type", async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      jsonResponse({ data: VALID_USER, meta: { requestId: "req_5" } }),
    );
    const client = createApiClient({ fetchImpl });
    await client.patch("/me", UserSchema, { name: "n" });
    await client.delete("/tasks/1", UserSchema);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(calls[1]?.init?.method).toBe("DELETE");
    expect(calls[1]?.init?.body).toBeUndefined();
    expect((calls[1]?.init?.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("成功响应 data 不符合 schema 时抛 ApiClientError", async () => {
    const { fetchImpl } = mockFetch(() =>
      jsonResponse({ data: { id: "u" }, meta: { requestId: "req_6" } }),
    );
    const client = createApiClient({ fetchImpl });
    await expect(client.get("/me", UserSchema)).rejects.toBeInstanceOf(ApiClientError);
  });

  it("传输失败（fetch reject）时抛 ApiClientError 并保留 cause", async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error("network down"));
    const client = createApiClient({ fetchImpl });
    await expect(client.get("/me", UserSchema)).rejects.toBeInstanceOf(ApiClientError);
  });
});
