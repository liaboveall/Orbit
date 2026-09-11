import { describe, expect, it } from "vitest";
import {
  CreateTaskSchema,
  ErrorResponseSchema,
  TaskListQuerySchema,
  buildErrorResponse,
  buildListResponse,
  buildSuccessResponse,
  parseQueryParams,
  parseRequestBody,
  UNASSIGNED_REQUEST_ID,
} from "@/contracts";

/**
 * 校验帮助函数测试（ORB-003）。
 * 关注：成功返回 typed data；失败返回标准 ErrorResponse 形状；不吞错误。
 */

describe("parseRequestBody", () => {
  it("正例：合法 body → {ok:true, data}（类型安全）", () => {
    const result = parseRequestBody(CreateTaskSchema, { title: "写契约测试", priority: "HIGH" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.title).toBe("写契约测试");
      expect(result.data.priority).toBe("HIGH");
    }
  });

  it("反例：非法 body → {ok:false, response} 为标准错误信封", () => {
    const result = parseRequestBody(CreateTaskSchema, { priority: "HIGH" }, "req_abc");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(ErrorResponseSchema.safeParse(result.response).success).toBe(true);
      expect(result.response.error.code).toBe("VALIDATION_ERROR");
      expect(result.response.meta.requestId).toBe("req_abc");
      // 缺失的 title 应映射进 fieldErrors。
      expect(result.response.error.fieldErrors).toBeDefined();
      expect(Object.keys(result.response.error.fieldErrors ?? {})).toContain("title");
    }
  });

  it("反例：未提供 requestId 时使用占位常量", () => {
    const result = parseRequestBody(CreateTaskSchema, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.meta.requestId).toBe(UNASSIGNED_REQUEST_ID);
    }
  });

  it("不吞错误：strict schema 拒绝未知字段", () => {
    const result = parseRequestBody(CreateTaskSchema, { title: "t", secret: "x" });
    expect(result.ok).toBe(false);
  });
});

describe("parseQueryParams", () => {
  it("正例：字符串查询参数被 coerce/转换为强类型", () => {
    const result = parseQueryParams(TaskListQuerySchema, {
      limit: "50",
      status: "TODO",
      unassigned: "true",
      sort: "due_asc",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.limit).toBe(50);
      expect(result.data.status).toBe("TODO");
      expect(result.data.unassigned).toBe(true);
      expect(result.data.sort).toBe("due_asc");
    }
  });

  it("反例：布尔查询字符串 \"false\" 转 false（而非 truthy 陷阱）", () => {
    const result = parseQueryParams(TaskListQuerySchema, { overdue: "false" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.overdue).toBe(false);
  });

  it("反例：limit 越界 / status 非法 → 错误信封", () => {
    expect(parseQueryParams(TaskListQuerySchema, { limit: "200" }).ok).toBe(false);
    expect(parseQueryParams(TaskListQuerySchema, { status: "DOING" }).ok).toBe(false);
  });
});

describe("buildErrorResponse", () => {
  it("构造合法 ErrorResponse，并可携带冲突版本", () => {
    const res = buildErrorResponse("VERSION_CONFLICT", "这条任务已被更新。", {
      requestId: "req_1",
      currentVersion: 5,
    });
    expect(ErrorResponseSchema.safeParse(res).success).toBe(true);
    expect(res.error.code).toBe("VERSION_CONFLICT");
    expect(res.error.currentVersion).toBe(5);
    expect(res.meta.requestId).toBe("req_1");
  });

  it("缺省 requestId 使用占位常量", () => {
    const res = buildErrorResponse("NOT_FOUND", "资源不存在");
    expect(res.meta.requestId).toBe(UNASSIGNED_REQUEST_ID);
  });

  it("不吞错误：message 超过 500 抛出（信封永远合法）", () => {
    expect(() => buildErrorResponse("INTERNAL_ERROR", "a".repeat(501))).toThrow();
  });
});

describe("buildSuccessResponse / buildListResponse", () => {
  it("成功信封：{data, meta:{requestId}}", () => {
    const res = buildSuccessResponse({ hello: "world" }, "req_9");
    expect(res.data).toEqual({ hello: "world" });
    expect(res.meta.requestId).toBe("req_9");
  });

  it("不吞错误：非法 requestId（空串）抛出", () => {
    expect(() => buildSuccessResponse({ a: 1 }, "")).toThrow();
    expect(() => buildSuccessResponse({ a: 1 }, "x".repeat(129))).toThrow();
  });

  it("列表信封：{data:T[], meta:PageMeta}，meta 被复校", () => {
    const res = buildListResponse([1, 2, 3], {
      requestId: "req_1",
      nextCursor: "c1",
      hasMore: true,
    });
    expect(res.data).toEqual([1, 2, 3]);
    expect(res.meta.hasMore).toBe(true);
    // 非法 PageMeta（缺 hasMore）应抛出。
    expect(() =>
      buildListResponse([], { requestId: "r", nextCursor: null } as unknown as never),
    ).toThrow();
  });
});
