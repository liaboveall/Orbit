/**
 * 错误日志脱敏基础设施 (R4 安全修复)
 *
 * 将错误对象转换为安全日志记录格式，移除所有可能包含敏感信息的字段。
 */
import "server-only";

/**
 * **脱敏策略**:
 * 只允许记录以下安全字段：
 * - requestId: 请求追踪 ID（无害，用于日志关联）
 * - errorCode: 领域错误码（如 VERSION_CONFLICT, NOT_FOUND）
 * - errorClass: 错误分类（如 "ValidationError", "AuthenticationError"）
 *
 * 完全删除敏感信息:message、name、stack 及其他任何自定义字段
 *
 * @param error 任意类型的错误对象
 * @param requestId 可选的请求追踪 ID
 * @returns 仅含安全字段的记录对象
 */
export function sanitizeErrorForLog(
  error: unknown,
  requestId?: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = {};

  if (requestId) {
    base.requestId = requestId;
  }

  if (error instanceof Error) {
    // 提取安全的 errorCode 字段（如果存在）
    const errorCode = (error as { code?: string }).code || undefined;

    // 提取错误类名（去掉 "Error" 后缀，避免泄露具体实现）
    const errorClass = error.constructor.name.replace(/Error$/, "") || "Unknown";

    if (errorCode) {
      base.errorCode = errorCode;
    }

    base.errorClass = errorClass;
  } else {
    // 非 Error 对象：只记录类型名称
    base.errorClass = typeof error;
  }

  return base;
}
