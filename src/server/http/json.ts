import "server-only";
import {
  buildListResponse,
  buildSuccessResponse,
  type PageMeta,
} from "@/contracts";
import { DomainError, NO_STORE } from "./errors";
import { REQUEST_ID_HEADER } from "./request-id";

/**
 * 共享 HTTP 响应/请求辅助（M2 起复用于所有 /api/v1 路由）。
 *
 * 从 `src/app/api/v1/me/route.ts` 抽取并泛化，避免每个路由重复构造信封与读体逻辑。
 * 职责（docs/03 §4、docs/05 §2/§10）：
 *  - 成功信封：`{data, meta}`（单对象）或 `{data:[], meta:PageMeta}`（列表），
 *    统一带 no-store 缓存策略与 x-request-id 头；
 *  - 请求体读取：64KiB 上限、Content-Length 前置拒绝、413/400 分流；
 *  - 幂等键读取：`Idempotency-Key` 必须为合法 UUID，否则 400 VALIDATION_ERROR。
 *
 * 本模块含 server-only 保护，仅服务端引用；不在此处做业务/授权判断。
 */

/** JSON 响应内容类型（显式 charset，避免中文乱码；与 HTTP 错误层一致）。 */
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/** 请求体大小上限（docs/05 §10：64KiB）。超限返回 413 PAYLOAD_TOO_LARGE，不无限制读入内存。 */
export const MAX_BODY_BYTES = 64 * 1024;

/** `Idempotency-Key` 请求头名称（docs/05 §5）。 */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

/** UUID（v1–v5）格式校验：8-4-4-4-12 十六进制。用于幂等键前置校验。 */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** 把信封序列化为标准 Response（no-store + x-request-id + JSON charset）。 */
function toResponse(body: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": JSON_CONTENT_TYPE,
      "cache-control": NO_STORE,
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}

/**
 * 200（或指定 status）成功信封响应：`{data, meta:{requestId}}`。
 * data 由调用方保证其 DTO 已按契约校验；本函数只做信封封装。
 */
export function jsonSuccess<T>(data: T, requestId: string, status = 200): Response {
  return toResponse(buildSuccessResponse(data, requestId), status, requestId);
}

/** 201 Created 成功信封响应（创建类操作）。 */
export function jsonCreated<T>(data: T, requestId: string): Response {
  return jsonSuccess(data, requestId, 201);
}

/** 204 responses retain the same private-cache and request-tracing policy. */
export function noContent(requestId: string): Response {
  return new Response(null, {
    status: 204,
    headers: { "cache-control": NO_STORE, [REQUEST_ID_HEADER]: requestId },
  });
}

/**
 * 列表信封响应：`{data:T[], meta:PageMeta}`（含 nextCursor/hasMore）。
 * meta 由调用方构造并含 requestId；响应头的 x-request-id 用传入的 requestId。
 */
export function jsonList<T>(data: T[], meta: PageMeta, requestId: string): Response {
  return toResponse(buildListResponse(data, meta), 200, requestId);
}

/**
 * 把**已构造好的标准信封**（如 parseRequestBody/parseQueryParams 失败返回的 ErrorResponse）
 * 序列化为响应，统一带 no-store + x-request-id + JSON charset。
 * 用于 400 校验失败等场景：调用方已持有完整合法信封，无需再经 DomainError 转换。
 */
export function jsonEnvelope(body: unknown, status: number, requestId: string): Response {
  return toResponse(body, status, requestId);
}

/** readJsonBody 的判别联合结果：成功携带 parsed body，失败区分是否超限。 */
export type ReadBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; tooLarge: boolean };

/**
 * 读取 JSON 请求体。空体或非 JSON 一律视为 400 VALIDATION_ERROR
 * （不抛裸 SyntaxError 让它变成 500，也不用 415 —— 契约未定义该场景的媒体类型码）。
 * 超过 MAX_BODY_BYTES 的请求体返回 `tooLarge`，由调用方映射为 413 PAYLOAD_TOO_LARGE。
 */
export async function readJsonBody(request: Request): Promise<ReadBodyResult> {
  // 1) 先按 Content-Length 快速拒绝超限请求（若声明），避免读取超大 body 占用内存。
  //    注意：chunked 传输无 Content-Length（get 返回 null，Number(null)=0），该前置检查会失效，
  //    故必须再用 getReader() 增量读取并按**真实字节数**累计限长（下方 3）。
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, tooLarge: true };
  }

  // 2) 无 body（如空体请求）：按空体分支处理（→ 400），避免 reader 为 null。
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, tooLarge: false };

  // 3) 增量读取：累计字节数一旦超限立即 cancel 并返回 tooLarge，不把整个超大 body 读入内存。
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return { ok: false, tooLarge: true };
    }
    chunks.push(value);
  }

  // 4) 合并 chunks 并按 UTF-8 解码（字节数为真实上限，较原先用 text.length 的 UTF-16 近似更准确）。
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8").decode(merged);

  if (text.trim().length === 0) return { ok: false, tooLarge: false };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

/**
 * 读取并校验 `Idempotency-Key` 请求头（docs/05 §5）。
 * 缺失或非法 UUID → 抛 400 VALIDATION_ERROR（DomainError，由 HTTP 层统一映射为信封）。
 * 
 * Q10 修复：返回规范化的 key（全部转小写），确保大写/小写 UUID 路径都能正确匹配。
 * 唯一性由 userId+method+routeKey+key 组合保证。
 */
export function requireIdempotencyKey(headers: Headers): string {
  const raw = headers.get(IDEMPOTENCY_KEY_HEADER);
  if (raw === null || raw.trim().length === 0 || !UUID_PATTERN.test(raw.trim())) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "缺少或非法的 Idempotency-Key，请提供合法的 UUID。",
      { "Idempotency-Key": ["必须是合法的 UUID 格式"] },
    );
  }
  // Q10: 规范化为小写以确保与 lowercase UUID path params 一致
  return raw.trim().toLowerCase();
}
