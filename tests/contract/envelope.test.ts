import { describe, expect, it } from "vitest";
import {
  ErrorDetailSchema,
  ErrorResponseSchema,
  ListResponseSchema,
  MetaSchema,
  PageMetaSchema,
  SuccessResponseSchema,
  UserSchema,
} from "@/contracts";

/**
 * 统一信封 schema 正反例/边界测试（ORB-003）。
 * 严格对齐 contracts/openapi.json components/schemas: Meta / PageMeta / Error。
 */

const repeat = (n: number): string => "a".repeat(n);

const VALID_USER = {
  id: "user_1",
  name: "张三",
  email: "zhangsan@example.com",
  emailVerified: true,
  timezone: "Asia/Shanghai",
};

describe("MetaSchema", () => {
  it("正例：合法 requestId 解析成功", () => {
    expect(MetaSchema.safeParse({ requestId: "req_123" }).success).toBe(true);
  });

  it("边界：requestId 恰好 1 / 128 字符均合法", () => {
    expect(MetaSchema.safeParse({ requestId: repeat(1) }).success).toBe(true);
    expect(MetaSchema.safeParse({ requestId: repeat(128) }).success).toBe(true);
  });

  it("反例：缺 requestId / 空串 / 超长 129 / 类型错误 均失败", () => {
    expect(MetaSchema.safeParse({}).success).toBe(false);
    expect(MetaSchema.safeParse({ requestId: "" }).success).toBe(false);
    expect(MetaSchema.safeParse({ requestId: repeat(129) }).success).toBe(false);
    expect(MetaSchema.safeParse({ requestId: 42 }).success).toBe(false);
  });

  it("反例：additionalProperties=false → 未知字段被拒", () => {
    expect(MetaSchema.safeParse({ requestId: "r", extra: 1 }).success).toBe(false);
  });
});

describe("PageMetaSchema", () => {
  const base = { requestId: "req_1", hasMore: false };

  it("正例：nextCursor 为 null 或合法字符串均成功", () => {
    expect(PageMetaSchema.safeParse({ ...base, nextCursor: null }).success).toBe(true);
    expect(PageMetaSchema.safeParse({ ...base, nextCursor: "cursor_abc" }).success).toBe(true);
  });

  it("边界：nextCursor 恰好 1 / 2048 字符合法，2049 失败", () => {
    expect(PageMetaSchema.safeParse({ ...base, nextCursor: repeat(1) }).success).toBe(true);
    expect(PageMetaSchema.safeParse({ ...base, nextCursor: repeat(2048) }).success).toBe(true);
    expect(PageMetaSchema.safeParse({ ...base, nextCursor: repeat(2049) }).success).toBe(false);
  });

  it("反例：三者皆 required，缺任一失败", () => {
    expect(PageMetaSchema.safeParse({ requestId: "r", hasMore: false }).success).toBe(false);
    expect(PageMetaSchema.safeParse({ nextCursor: null, hasMore: false }).success).toBe(false);
    expect(PageMetaSchema.safeParse({ requestId: "r", nextCursor: null }).success).toBe(false);
  });

  it("反例：hasMore 必须是布尔", () => {
    expect(PageMetaSchema.safeParse({ ...base, nextCursor: null, hasMore: "true" }).success).toBe(
      false,
    );
  });
});

describe("ErrorDetailSchema", () => {
  it("正例：仅 code+message（required 最小集）成功", () => {
    expect(ErrorDetailSchema.safeParse({ code: "NOT_FOUND", message: "资源不存在" }).success).toBe(
      true,
    );
  });

  it("正例：携带 fieldErrors / currentVersion / currentBoardVersion 成功", () => {
    const value = {
      code: "VERSION_CONFLICT",
      message: "已被更新",
      fieldErrors: { title: ["不能为空"] },
      currentVersion: 5,
      currentBoardVersion: 12,
    };
    expect(ErrorDetailSchema.safeParse(value).success).toBe(true);
  });

  it("边界：code 恰好 1/80，message 恰好 1/500 合法", () => {
    expect(ErrorDetailSchema.safeParse({ code: repeat(1), message: repeat(1) }).success).toBe(true);
    expect(ErrorDetailSchema.safeParse({ code: repeat(80), message: repeat(500) }).success).toBe(
      true,
    );
  });

  it("反例：code 81 / message 501 / 空串 失败", () => {
    expect(ErrorDetailSchema.safeParse({ code: repeat(81), message: "m" }).success).toBe(false);
    expect(ErrorDetailSchema.safeParse({ code: "C", message: repeat(501) }).success).toBe(false);
    expect(ErrorDetailSchema.safeParse({ code: "", message: "m" }).success).toBe(false);
  });

  it("反例：currentVersion 必须为 ≥1 的整数（0 / 1.5 失败）", () => {
    expect(
      ErrorDetailSchema.safeParse({ code: "C", message: "m", currentVersion: 0 }).success,
    ).toBe(false);
    expect(
      ErrorDetailSchema.safeParse({ code: "C", message: "m", currentVersion: 1.5 }).success,
    ).toBe(false);
  });

  it("反例：fieldErrors 值必须是 string[]", () => {
    expect(
      ErrorDetailSchema.safeParse({ code: "C", message: "m", fieldErrors: { a: "not-array" } })
        .success,
    ).toBe(false);
  });
});

describe("ErrorResponseSchema", () => {
  it("正例：{error, meta} 完整信封成功", () => {
    const value = {
      error: { code: "NOT_FOUND", message: "资源不存在" },
      meta: { requestId: "req_1" },
    };
    expect(ErrorResponseSchema.safeParse(value).success).toBe(true);
  });

  it("反例：缺 meta / 未知顶层字段 失败", () => {
    expect(ErrorResponseSchema.safeParse({ error: { code: "C", message: "m" } }).success).toBe(
      false,
    );
    expect(
      ErrorResponseSchema.safeParse({
        error: { code: "C", message: "m" },
        meta: { requestId: "r" },
        stack: "……",
      }).success,
    ).toBe(false);
  });
});

describe("SuccessResponseSchema / ListResponseSchema 泛型构造器", () => {
  it("成功信封 {data,meta} 用具体 schema 校验并推导类型", () => {
    const schema = SuccessResponseSchema(UserSchema);
    const ok = schema.safeParse({ data: VALID_USER, meta: { requestId: "req_1" } });
    expect(ok.success).toBe(true);
    if (ok.success) {
      // 类型推导：data.email 应可访问（UserDTO）。
      expect(ok.data.data.email).toBe("zhangsan@example.com");
    }
    expect(schema.safeParse({ data: { ...VALID_USER, email: "bad" }, meta: { requestId: "r" } }).success).toBe(
      false,
    );
    expect(schema.safeParse({ data: VALID_USER }).success).toBe(false);
  });

  it("列表信封 {data:T[],meta:PageMeta} 校验数组与分页 meta", () => {
    const schema = ListResponseSchema(UserSchema);
    const ok = schema.safeParse({
      data: [VALID_USER],
      meta: { requestId: "req_1", nextCursor: null, hasMore: false },
    });
    expect(ok.success).toBe(true);
    // data 非数组失败；meta 缺 hasMore 失败。
    expect(
      schema.safeParse({ data: VALID_USER, meta: { requestId: "r", nextCursor: null, hasMore: false } })
        .success,
    ).toBe(false);
    expect(schema.safeParse({ data: [], meta: { requestId: "r", nextCursor: null } }).success).toBe(
      false,
    );
    // 空数组合法。
    expect(
      schema.safeParse({ data: [], meta: { requestId: "r", nextCursor: null, hasMore: false } }).success,
    ).toBe(true);
  });
});
