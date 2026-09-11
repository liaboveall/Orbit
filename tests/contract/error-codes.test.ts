import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  ERROR_CODES_BY_STATUS,
  ERROR_CODE_STATUS,
  ErrorCodeSchema,
  HTTP_ERROR_STATUSES,
  httpStatusForErrorCode,
  isErrorCode,
} from "@/contracts";

/**
 * 错误码契约测试（ORB-003）。
 * 权威来源：docs/05-API-CONTRACT.md §3 错误码全表。
 */

/** docs/05 §3 表逐行抄录：HTTP → code[]。用于交叉校验实现无遗漏/无多余。 */
const DOC_05_TABLE: Record<number, string[]> = {
  400: ["VALIDATION_ERROR", "INVALID_CURSOR"],
  401: ["UNAUTHENTICATED"],
  403: ["FORBIDDEN", "EMAIL_UNVERIFIED", "ORIGIN_NOT_ALLOWED"],
  404: ["NOT_FOUND"],
  409: [
    "VERSION_CONFLICT",
    "BOARD_CONFLICT",
    "PROJECT_KEY_TAKEN",
    "PROJECT_ARCHIVED",
    "INVITATION_USED",
    "ALREADY_EXISTS",
    "IDEMPOTENCY_CONFLICT",
    "UPLOAD_IN_PROGRESS",
    "LOCKED",
  ],
  410: ["INVITATION_EXPIRED", "INVITATION_REVOKED"],
  413: ["PAYLOAD_TOO_LARGE"],
  415: ["UNSUPPORTED_FILE_TYPE"],
  422: ["LIMIT_EXCEEDED", "ASSIGNEE_NOT_MEMBER", "INVALID_BOARD_TARGET"],
  429: ["RATE_LIMITED"],
  500: ["INTERNAL_ERROR"],
  503: ["STORAGE_UNAVAILABLE", "SERVICE_UNAVAILABLE"],
};

describe("错误码 ↔ docs/05 §3 全表", () => {
  const docCodes = Object.values(DOC_05_TABLE).flat();

  it("覆盖表中全部错误码，且无多余码", () => {
    expect([...ERROR_CODES].sort()).toEqual([...docCodes].sort());
    expect(ERROR_CODES.length).toBe(docCodes.length);
  });

  it("每个错误码映射到表中对应的 HTTP 状态码", () => {
    for (const [statusText, codes] of Object.entries(DOC_05_TABLE)) {
      const status = Number(statusText);
      for (const code of codes) {
        expect(ERROR_CODE_STATUS[code as keyof typeof ERROR_CODE_STATUS]).toBe(status);
      }
    }
  });

  it("ERROR_CODE_STATUS 的键集与 ERROR_CODES 完全一致", () => {
    expect(Object.keys(ERROR_CODE_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });

  it("ERROR_CODES_BY_STATUS 分组与 ERROR_CODE_STATUS 一致（交叉校验）", () => {
    for (const [statusText, codes] of Object.entries(ERROR_CODES_BY_STATUS)) {
      const status = Number(statusText);
      expect(HTTP_ERROR_STATUSES).toContain(status as (typeof HTTP_ERROR_STATUSES)[number]);
      for (const code of codes) {
        expect(ERROR_CODE_STATUS[code]).toBe(status);
      }
    }
    // 分组视图应覆盖全部错误码。
    const grouped = Object.values(ERROR_CODES_BY_STATUS).flat();
    expect([...grouped].sort()).toEqual([...ERROR_CODES].sort());
  });

  it("httpStatusForErrorCode 返回正确状态码", () => {
    expect(httpStatusForErrorCode("NOT_FOUND")).toBe(404);
    expect(httpStatusForErrorCode("VERSION_CONFLICT")).toBe(409);
    expect(httpStatusForErrorCode("RATE_LIMITED")).toBe(429);
    expect(httpStatusForErrorCode("INTERNAL_ERROR")).toBe(500);
    expect(httpStatusForErrorCode("STORAGE_UNAVAILABLE")).toBe(503);
  });
});

describe("ErrorCodeSchema / isErrorCode", () => {
  it("接受全部已定义错误码", () => {
    for (const code of ERROR_CODES) {
      expect(ErrorCodeSchema.safeParse(code).success).toBe(true);
      expect(isErrorCode(code)).toBe(true);
    }
  });

  it("拒绝未定义的错误码字符串", () => {
    expect(ErrorCodeSchema.safeParse("NOT_A_CODE").success).toBe(false);
    expect(isErrorCode("NOT_A_CODE")).toBe(false);
    expect(isErrorCode("")).toBe(false);
  });
});
