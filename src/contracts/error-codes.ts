import { z } from "zod";

/**
 * 契约层错误码（ORB-003）。
 *
 * 权威来源：docs/05-API-CONTRACT.md §3「错误码」全表，并与 openapi.json 的
 * components/responses/BusinessError 语义一致。错误 message 面向普通用户，
 * code 供程序分支判断；HTTP 层负责把领域错误映射为这些 code（docs/03 §4）。
 *
 * 设计：
 *  - `ERROR_CODES`：全部错误码的只读元组（唯一真源，供 z.enum 派生类型安全的联合）。
 *  - `ERROR_CODE_STATUS`：每个错误码 → 其 HTTP 状态码的类型安全映射。
 *  - `ERROR_CODES_BY_STATUS`：按 HTTP 状态码分组的便捷视图（由测试交叉校验与上表一致）。
 *
 * 本模块无服务端依赖，可进入客户端 bundle（前端可据 code/状态做 UX 分支）。
 */

/** 业务错误涉及的 HTTP 状态码集合（docs/05 §3 表的 HTTP 列）。 */
export const HTTP_ERROR_STATUSES = [
  400, 401, 403, 404, 409, 410, 413, 415, 422, 429, 500, 503,
] as const;
export type HttpStatus = (typeof HTTP_ERROR_STATUSES)[number];
export const HttpStatusSchema = z.number().int().refine(
  (n): n is HttpStatus => (HTTP_ERROR_STATUSES as readonly number[]).includes(n),
  { message: "必须是 docs/05 §3 定义的业务错误 HTTP 状态码" },
);

/** 全部错误码（唯一真源）。顺序按 HTTP 状态码分组，便于阅读与 diff。 */
export const ERROR_CODES = [
  // 400
  "VALIDATION_ERROR",
  "INVALID_CURSOR",
  // 401
  "UNAUTHENTICATED",
  // 403
  "FORBIDDEN",
  "EMAIL_UNVERIFIED", // Reserved public contract value; no current business throw site.
  "ORIGIN_NOT_ALLOWED",
  // 404
  "NOT_FOUND",
  // 409
  "VERSION_CONFLICT",
  "BOARD_CONFLICT",
  "PROJECT_KEY_TAKEN",
  "PROJECT_ARCHIVED",
  "INVITATION_USED",
  "ALREADY_EXISTS", // Reserved public contract value; retained for compatibility.
  "IDEMPOTENCY_CONFLICT",
  "UPLOAD_IN_PROGRESS",
  "LOCKED",
  // 410
  "INVITATION_EXPIRED",
  "INVITATION_REVOKED",
  // 413
  "PAYLOAD_TOO_LARGE",
  // 415
  "UNSUPPORTED_FILE_TYPE",
  // 422
  "LIMIT_EXCEEDED",
  "ASSIGNEE_NOT_MEMBER",
  "INVALID_BOARD_TARGET",
  // 429
  "RATE_LIMITED",
  // 500
  "INTERNAL_ERROR",
  // 503
  "STORAGE_UNAVAILABLE",
  "SERVICE_UNAVAILABLE",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** 运行时校验：仅接受已定义的错误码字符串。 */
export const ErrorCodeSchema = z.enum(ERROR_CODES);

/**
 * 错误码 → HTTP 状态码映射（类型安全：键必须覆盖且仅覆盖全部 ErrorCode，
 * 值必须是 HttpStatus）。`satisfies` 保证遗漏或多余键在编译期即报错。
 */
export const ERROR_CODE_STATUS = {
  VALIDATION_ERROR: 400,
  INVALID_CURSOR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  EMAIL_UNVERIFIED: 403,
  ORIGIN_NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  BOARD_CONFLICT: 409,
  PROJECT_KEY_TAKEN: 409,
  PROJECT_ARCHIVED: 409,
  INVITATION_USED: 409,
  ALREADY_EXISTS: 409,
  IDEMPOTENCY_CONFLICT: 409,
  UPLOAD_IN_PROGRESS: 409,
  LOCKED: 409,
  INVITATION_EXPIRED: 410,
  INVITATION_REVOKED: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  LIMIT_EXCEEDED: 422,
  ASSIGNEE_NOT_MEMBER: 422,
  INVALID_BOARD_TARGET: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  STORAGE_UNAVAILABLE: 503,
  SERVICE_UNAVAILABLE: 503,
} as const satisfies Record<ErrorCode, HttpStatus>;

/** 按 HTTP 状态码分组的错误码（便捷视图；由契约测试交叉校验与 ERROR_CODE_STATUS 一致）。 */
export const ERROR_CODES_BY_STATUS = {
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
} as const satisfies Record<HttpStatus, readonly ErrorCode[]>;

/** 取某错误码对应的 HTTP 状态码（类型安全，未知键在编译期即拒绝）。 */
export function httpStatusForErrorCode(code: ErrorCode): HttpStatus {
  return ERROR_CODE_STATUS[code];
}
