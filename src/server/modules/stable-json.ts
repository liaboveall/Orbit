import "server-only";
import { createHash } from "node:crypto";

/**
 * 稳定 JSON 序列化与摘要（M2 共享基础设施）。
 *
 * 用途：
 *  - 幂等请求指纹（docs/05 §5）：同一逻辑请求无论字段书写顺序如何，
 *    规范化后 SHA-256 必须一致，故对象键需**递归排序**后再序列化。
 *  - 分页过滤指纹（docs/05 §6）：游标绑定当前过滤条件，过滤变化即游标失效。
 *
 * 规则（对齐 JSON.stringify 语义，避免把 undefined 变成 "null"）：
 *  - 对象：跳过值为 undefined 的键；键按字典序排序后拼接。
 *  - 数组：保持顺序（顺序对数组是有意义的），逐项递归。
 *  - 其它：交给 JSON.stringify（字符串加引号、数字/布尔/ null 原样）。
 */

/** 递归稳定序列化：对象键排序、跳过 undefined，数组保序。 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${stableStringify(item)}`);
  }
  return `{${parts.join(",")}}`;
}

/** 计算字符串的 SHA-256 十六进制摘要（64 位小写）。 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
