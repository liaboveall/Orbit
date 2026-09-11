import "server-only";
import { DomainError } from "@/server/http/errors";
import { sha256Hex, stableStringify } from "@/server/modules/stable-json";

/**
 * 游标（keyset）分页基础设施（M2 / ORB-007，docs/05 §6）。
 *
 * 约定：
 *  - 游标是**不透明**串，内部携带排序字段值 + 末项 id + 过滤指纹；
 *  - 过滤指纹把游标绑定到当前过滤条件：过滤变了，旧游标失效（400 INVALID_CURSOR），
 *    防止跨过滤拼接出错误结果，也不把游标当授权证明；
 *  - 编码用 base64url（URL 安全，无需再转义），长度受契约 CursorSchema(≤2048) 约束。
 */

/** 过滤指纹截断长度（16 hex 字符，足以区分过滤组合且游标短小）。 */
const FINGERPRINT_LENGTH = 16;

/** 游标内部结构。 */
interface CursorPayload {
  /** 排序字段值（如 [updatedAtISO, id]）。 */
  v: unknown[];
  /** 末项 id（keyset 去重与稳定排序）。 */
  id: string;
  /** 过滤指纹。 */
  f: string;
}

/** 游标无效或过滤不匹配 —— 400 INVALID_CURSOR。 */
export function invalidCursorError(): DomainError {
  return new DomainError("INVALID_CURSOR", "分页游标无效或与当前过滤条件不匹配，请刷新列表。");
}

/** 计算过滤条件的指纹：稳定序列化后 SHA-256，截断到 16 字符。 */
export function computeFilterFingerprint(filters: Record<string, unknown>): string {
  return sha256Hex(stableStringify(filters)).slice(0, FINGERPRINT_LENGTH);
}

/** 编码游标：base64url(JSON({v, id, f}))。 */
export function encodeCursor(
  sortValues: unknown[],
  id: string,
  filterFingerprint: string,
): string {
  const payload: CursorPayload = { v: sortValues, id, f: filterFingerprint };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * 解码并校验游标：结构不合法或过滤指纹不匹配 → 抛 400 INVALID_CURSOR。
 * 返回排序字段值与末项 id，供调用方构造 keyset WHERE。
 */
export function decodeCursor(
  cursor: string,
  expectedFingerprint: string,
): { sortValues: unknown[]; id: string } {
  let parsed: unknown;
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw invalidCursorError();
  }

  if (typeof parsed !== "object" || parsed === null) throw invalidCursorError();
  const candidate = parsed as Partial<CursorPayload>;
  if (
    !Array.isArray(candidate.v) ||
    typeof candidate.id !== "string" ||
    typeof candidate.f !== "string"
  ) {
    throw invalidCursorError();
  }
  if (candidate.f !== expectedFingerprint) throw invalidCursorError();

  return { sortValues: candidate.v, id: candidate.id };
}
