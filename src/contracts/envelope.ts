import { z } from "zod";
import { CursorSchema, RequestIdSchema, VersionSchema } from "./primitives";

/**
 * 统一响应信封（ORB-003）。
 *
 * 严格对齐 contracts/openapi.json components/schemas 的 Meta / PageMeta / Error，
 * 以及各 endpoint 200 响应中反复出现的 `{data, meta}` 成功信封（additionalProperties:false）。
 *
 * 约定（docs/05 §2）：
 *  - 成功：{data, meta:{requestId}}；列表 meta 增加 nextCursor（可空）、hasMore。
 *  - 错误：{error:{code,message,fieldErrors?,currentVersion?,currentBoardVersion?}, meta:{requestId}}。
 *  - 不用 200 携带 error 假装成功（信封形状即区分成功/失败）。
 *
 * 全部使用 `.strict()`（= OpenAPI additionalProperties:false），拒绝未知字段，
 * 防止把 password/session/tokenHash/objectKey/堆栈等越权字段悄悄塞进信封。
 *
 * 本模块无服务端依赖，可进入客户端 bundle。
 */

/* ── meta ─────────────────────────────────────────────────────────────── */

/** Meta：{ requestId }，additionalProperties:false。 */
export const MetaSchema = z.strictObject({
  requestId: RequestIdSchema,
});
export type Meta = z.infer<typeof MetaSchema>;

/** PageMeta：{ requestId, nextCursor(可空), hasMore }，三者 required。 */
export const PageMetaSchema = z.strictObject({
  requestId: RequestIdSchema,
  nextCursor: CursorSchema.nullable(),
  hasMore: z.boolean(),
});
export type PageMeta = z.infer<typeof PageMetaSchema>;

/* ── error envelope ───────────────────────────────────────────────────── */

/**
 * Error.error 明细。code 按 openapi 为通用 string(1–80)（服务端产出时应为 ErrorCode 之一，
 * 见 error-codes.ts）；message 面向用户 string(1–500)。可选携带字段级错误与冲突版本。
 */
export const ErrorDetailSchema = z.strictObject({
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(500),
  fieldErrors: z.record(z.string(), z.array(z.string().min(1).max(500))).optional(),
  currentVersion: VersionSchema.optional(),
  currentBoardVersion: VersionSchema.optional(),
});
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

/** Error：{ error, meta }，additionalProperties:false。 */
export const ErrorResponseSchema = z.strictObject({
  error: ErrorDetailSchema,
  meta: MetaSchema,
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/* ── success envelopes（泛型辅助）──────────────────────────────────────── */

/**
 * 成功信封构造器：`{ data: T, meta: Meta }`。
 * 传入 data 的 Zod schema，返回严格信封 schema（类型安全，data 类型由入参推导）。
 *
 * 命名为 PascalCase 以对齐任务约定的 `SuccessResponseSchema<T>`；
 * 因 Zod 需要「data 的 schema」而非「data 的类型」，故实现为接受 schema 的函数。
 */
export function SuccessResponseSchema<T extends z.ZodType>(dataSchema: T) {
  return z.strictObject({
    data: dataSchema,
    meta: MetaSchema,
  });
}

/** 列表信封构造器：`{ data: T[], meta: PageMeta }`。 */
export function ListResponseSchema<T extends z.ZodType>(itemSchema: T) {
  return z.strictObject({
    data: z.array(itemSchema),
    meta: PageMetaSchema,
  });
}

/** 成功信封类型（非列表）：{ data: T, meta: Meta }。 */
export type SuccessResponse<T> = {
  data: T;
  meta: Meta;
};

/** 列表信封类型：{ data: T[], meta: PageMeta }。 */
export type ListResponse<T> = {
  data: T[];
  meta: PageMeta;
};
