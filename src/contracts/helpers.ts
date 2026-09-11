import { z } from "zod";
import { ERROR_CODES, type ErrorCode } from "./error-codes";
import {
  ErrorResponseSchema,
  MetaSchema,
  PageMetaSchema,
  type ErrorDetail,
  type ErrorResponse,
  type ListResponse,
  type PageMeta,
  type SuccessResponse,
} from "./envelope";

/**
 * 校验与信封构造帮助函数（ORB-003）。
 *
 * 目标（AGENTS.md：外部输入统一运行时 schema 校验；docs/05 §2：统一信封）：
 *  - 解析失败返回「标准 ErrorResponse 形状」，而不是抛裸异常或吞掉错误；
 *  - 所有函数类型安全，产出物再用对应 Zod schema 复校一次，保证信封永远合法；
 *  - 不隐藏任何校验问题：字段级错误映射到 fieldErrors，顶层给面向用户的 message。
 *
 * 本模块无服务端依赖，可进入客户端 bundle（客户端也可用它校验表单/响应）。
 */

/** 调用方未提供 requestId 时使用的占位（满足 Meta.requestId 的 1–128 约束）。 */
export const UNASSIGNED_REQUEST_ID = "unassigned";

/** ErrorDetail.message 上限 500（对齐 openapi），映射 issue 文案时截断。 */
const MESSAGE_MAX = 500;

/** 解析结果判别联合：成功携带 typed data，失败携带标准 ErrorResponse。 */
export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: ErrorResponse };

/** buildErrorResponse 的可选参数。 */
export interface BuildErrorOptions {
  /** meta.requestId；缺省用 UNASSIGNED_REQUEST_ID（HTTP 层应传入真实请求 ID）。 */
  requestId?: string;
  /** 字段级错误：field → 面向用户的提示数组。 */
  fieldErrors?: Record<string, string[]>;
  /** 409 VERSION_CONFLICT 时回传的当前版本。 */
  currentVersion?: number;
  /** 409 BOARD_CONFLICT 时回传的当前看板版本。 */
  currentBoardVersion?: number;
}

/** 把 Zod 校验错误映射为 fieldErrors（path 用 `.` 连接；文案截断到 500 且非空）。 */
function fieldErrorsFromIssues(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
    const message = issue.message.slice(0, MESSAGE_MAX);
    const bucket = fieldErrors[key];
    if (bucket) {
      bucket.push(message.length > 0 ? message : "输入不合法");
    } else {
      fieldErrors[key] = [message.length > 0 ? message : "输入不合法"];
    }
  }
  return fieldErrors;
}

/**
 * 构造标准 ErrorResponse。产出前用 ErrorResponseSchema 复校，
 * 若 message 超长或 code 非法等会抛出（不吞错误），确保返回值一定合法。
 */
export function buildErrorResponse(
  code: ErrorCode,
  message: string,
  options: BuildErrorOptions = {},
): ErrorResponse {
  const detail: ErrorDetail = { code, message };
  if (options.fieldErrors !== undefined) detail.fieldErrors = options.fieldErrors;
  if (options.currentVersion !== undefined) detail.currentVersion = options.currentVersion;
  if (options.currentBoardVersion !== undefined) {
    detail.currentBoardVersion = options.currentBoardVersion;
  }

  const response: ErrorResponse = {
    error: detail,
    meta: { requestId: options.requestId ?? UNASSIGNED_REQUEST_ID },
  };
  return ErrorResponseSchema.parse(response);
}

/** 由 Zod 校验错误构造 400 VALIDATION_ERROR 的 ErrorResponse。 */
function validationErrorResponse(error: z.ZodError, requestId: string): ErrorResponse {
  const fieldErrors = fieldErrorsFromIssues(error);
  return buildErrorResponse("VALIDATION_ERROR", "请求校验未通过，请检查输入后重试。", {
    requestId,
    fieldErrors: Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
  });
}

/**
 * 校验请求体。成功返回 `{ok:true,data}`（typed），失败返回 `{ok:false,response}`（标准信封）。
 * 不吞错误：所有 Zod issue 映射进 fieldErrors。
 */
export function parseRequestBody<T extends z.ZodType>(
  schema: T,
  body: unknown,
  requestId: string = UNASSIGNED_REQUEST_ID,
): ParseResult<z.output<T>> {
  const result = schema.safeParse(body);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, response: validationErrorResponse(result.error, requestId) };
}

/**
 * 校验查询参数。语义同 parseRequestBody。
 * 传入原始 params（如 URLSearchParams 转换而来的 Record），由 schema 负责 coerce/enum 转换。
 */
export function parseQueryParams<T extends z.ZodType>(
  schema: T,
  params: unknown,
  requestId: string = UNASSIGNED_REQUEST_ID,
): ParseResult<z.output<T>> {
  const result = schema.safeParse(params);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, response: validationErrorResponse(result.error, requestId) };
}

/**
 * 构造成功信封 `{data, meta:{requestId}}`。
 * requestId 用 MetaSchema 复校（为空/超长会抛），data 由调用方保证其 DTO 已校验。
 */
export function buildSuccessResponse<T>(data: T, requestId: string): SuccessResponse<T> {
  const meta = MetaSchema.parse({ requestId });
  return { data, meta };
}

/**
 * 构造列表信封 `{data:T[], meta:PageMeta}`。
 * meta 用 PageMetaSchema 复校，保证 nextCursor/hasMore/requestId 合法。
 */
export function buildListResponse<T>(data: T[], meta: PageMeta): ListResponse<T> {
  const validatedMeta = PageMetaSchema.parse(meta);
  return { data, meta: validatedMeta };
}

/** 便于运行时判断某字符串是否为已定义错误码（类型守卫）。 */
export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}
