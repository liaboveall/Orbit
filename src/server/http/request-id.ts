import "server-only";
import { randomUUID } from "node:crypto";

/**
 * 请求 ID 基础设施（M1 / ORB-004）。
 *
 * 请求生命周期第一步即分配 requestId（docs/03 §4），贯穿结构化日志（§8）与响应信封 meta.requestId
 * （docs/05 §2、contracts MetaSchema）。使用 UUID v4，长度固定 36，满足 RequestIdSchema 的 1–128 约束。
 *
 * 安全：回显上游 x-request-id 前必须用白名单正则清洗，防止把 CRLF/超长/控制字符注入响应头。
 */

/** 承载 requestId 的响应/请求头名称。 */
export const REQUEST_ID_HEADER = "x-request-id";

/** 允许的 requestId 字符集与长度（清洗上游值，防注入）。UUID 天然匹配。 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** 生成一个新的唯一请求 ID（UUID v4）。 */
export function generateRequestId(): string {
  return randomUUID();
}

/**
 * 解析请求 ID：优先复用上游（代理）传入且**格式合法**的 x-request-id 以保持链路连续，
 * 否则生成新的 UUID。绝不回显未清洗的值。
 */
export function resolveRequestId(headers?: Headers): string {
  const incoming = headers?.get(REQUEST_ID_HEADER);
  if (incoming && REQUEST_ID_PATTERN.test(incoming)) {
    return incoming;
  }
  return generateRequestId();
}

/** 从 Request 解析请求 ID。 */
export function resolveRequestIdFromRequest(request: Request): string {
  return resolveRequestId(request.headers);
}
