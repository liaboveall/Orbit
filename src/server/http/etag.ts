import "server-only";

/**
 * 条件请求辅助（RFC 9110 §8.8.3、§13.1.2）。
 *
 * 只服务于 GET 的 If-None-Match：比较用**弱比较**，即忽略 `W/` 前缀后逐字节比较
 * 引号内的 opaque-tag。`*` 匹配任何当前表示。
 */

/** 把不透明标记包成强 ETag（加引号）。标记只含十六进制字符，不需要转义。 */
export function toEtag(token: string): string {
  return `"${token}"`;
}

/** 去掉弱校验前缀，得到用于比较的 opaque-tag（含引号）。 */
function opaqueTag(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("W/") ? trimmed.slice(2) : trimmed;
}

/**
 * If-None-Match 是否命中当前 ETag。头缺失或为空 → 不命中（正常返回 200）。
 * 列表形式按逗号拆分；本项目的标记不含逗号和引号，无需完整的 quoted-string 解析。
 */
export function ifNoneMatchSatisfied(header: string | null, etag: string): boolean {
  if (header === null) return false;
  const current = opaqueTag(etag);
  for (const candidate of header.split(",")) {
    const tag = candidate.trim();
    if (tag === "") continue;
    if (tag === "*" || opaqueTag(tag) === current) return true;
  }
  return false;
}
