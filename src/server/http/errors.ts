import "server-only";
import {
  buildErrorResponse,
  httpStatusForErrorCode,
  type ErrorCode,
  type ErrorResponse,
} from "@/contracts";
import { REQUEST_ID_HEADER } from "./request-id";
import { sanitizeErrorForLog } from "./sanitize-error";

/**
 * 错误映射基础设施（M1 / ORB-004）。
 *
 * 职责（docs/03 §4/§8、AGENTS.md）：把领域/业务错误统一转成标准 ErrorResponse 信封，
 * HTTP 状态码由 ErrorCode 派生；**绝不**把 SQL 错误、堆栈或第三方原始响应回传用户。
 * 所有错误响应带 requestId 与 `Cache-Control: private, no-store`（授权/私有内容不进公共缓存）。
 */

/** 授权/私有响应统一缓存策略：禁止任何共享缓存存储。 */
export const NO_STORE = "private, no-store";

/** JSON 响应内容类型（显式 charset，避免中文乱码）。 */
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/**
 * 领域错误的可选补充明细（docs/05 §3）：并发冲突时回传当前版本，
 * 供客户端刷新后重试。仅写入契约 ErrorDetail 已定义的字段。
 */
export interface DomainErrorDetails {
  /** 409 VERSION_CONFLICT：资源当前 version。 */
  currentVersion?: number;
  /** 409 BOARD_CONFLICT：项目当前 boardVersion。 */
  currentBoardVersion?: number;
}

/**
 * 领域错误：业务层抛出，携带契约 ErrorCode + 面向用户的 message（+ 可选字段级错误 + 可选冲突明细）。
 * HTTP 层用 toErrorResponse 统一映射，不在业务层直接构造 Response。
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: Record<string, string[]>;
  readonly details?: DomainErrorDetails;

  constructor(
    code: ErrorCode,
    message: string,
    fieldErrors?: Record<string, string[]>,
    details?: DomainErrorDetails,
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    if (fieldErrors) this.fieldErrors = fieldErrors;
    if (details) this.details = details;
  }

  /** 该错误对应的 HTTP 状态码（由 ErrorCode 派生，类型安全）。 */
  get status(): number {
    return httpStatusForErrorCode(this.code);
  }
}

/** 构造错误信封响应体（复用契约 helper，产出前经 ErrorResponseSchema 复校）。 */
function buildBody(
  code: ErrorCode,
  message: string,
  requestId: string,
  fieldErrors?: Record<string, string[]>,
  details?: DomainErrorDetails,
): ErrorResponse {
  return buildErrorResponse(code, message, {
    requestId,
    fieldErrors,
    currentVersion: details?.currentVersion,
    currentBoardVersion: details?.currentBoardVersion,
  });
}

/** 把错误信封序列化为标准 Response（含 requestId 头与 no-store 缓存策略）。 */
function toResponse(body: ErrorResponse, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": JSON_CONTENT_TYPE,
      "cache-control": NO_STORE,
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}

/** 由 ErrorCode 构造错误 Response（状态码自动派生）。 */
export function errorResponse(
  code: ErrorCode,
  message: string,
  requestId: string,
  fieldErrors?: Record<string, string[]>,
): Response {
  const body = buildBody(code, message, requestId, fieldErrors);
  return toResponse(body, httpStatusForErrorCode(code), requestId);
}

/** 由 DomainError 构造错误 Response（透传 fieldErrors 与冲突明细 details）。 */
export function domainErrorResponse(error: DomainError, requestId: string): Response {
  const body = buildBody(error.code, error.message, requestId, error.fieldErrors, error.details);
  const response = toResponse(body, error.status, requestId);
  if (error.code === "RATE_LIMITED") response.headers.set("Retry-After", "60");
  return response;
}

/**
 * 500 兜底：仅回通用文案，不泄露内部细节。
 * 调用方可在日志中记录脱敏后的 requestId + errorCode（docs/03 §8），但**不**记录堆栈到响应。
 */
export function internalErrorResponse(requestId: string): Response {
  return errorResponse("INTERNAL_ERROR", "服务器内部错误，请稍后重试。", requestId);
}

/**
 * 统一异常 → 标准信封映射：DomainError 走其 code/status；其它一律收敛为 500 INTERNAL_ERROR，
 * 不把原始 error.message / 堆栈透传给用户。
 *
 * 对于非 DomainError 的意外错误，在返回 500 前记录**完全脱敏**日志（仅 requestId、errorCode、errorClass），
 * 便于运维定位；绝对不泄露 message/name/stack 等敏感字段到日志或响应体。
 */
export function toErrorResponse(error: unknown, requestId: string): Response {
  if (error instanceof DomainError) {
    return domainErrorResponse(error, requestId);
  }
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (typeof code === "string" && ["P1001", "P1002", "P1008", "P1017", "P2024", "ECONNREFUSED", "ECONNRESET", "57P01", "53300"].includes(code)) {
    console.error(JSON.stringify({ requestId, errorCode: "SERVICE_UNAVAILABLE" }));
    return errorResponse("SERVICE_UNAVAILABLE", "服务暂时不可用，请稍后重试。", requestId);
  }
  // 脱敏日志：只记录安全的结构化字段（requestId、errorCode、errorClass），
  // 完全移除可能含敏感信息的 message/name/stack 等字段
  const sanitized = sanitizeErrorForLog(error, requestId);
  console.error(JSON.stringify(sanitized));
  return internalErrorResponse(requestId);
}
