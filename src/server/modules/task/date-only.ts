import "server-only";

/**
 * date-only 映射辅助（M2 / ORB-008，docs/04 §1、docs/05 §2）。
 *
 * Task.dueDate 是 PostgreSQL `date`（Prisma `@db.Date`），网络层传输为 "YYYY-MM-DD" 字符串。
 * 关键陷阱：**不可用浏览器/服务器本地午夜的 Date 来回传 date-only**（会因时区偏移错一天）。
 * 因此本模块所有转换一律基于 UTC：
 *  - toDueDateString 用 getUTC* 取年月日，忽略运行环境 TZ；
 *  - fromDueDateString 用 Date.UTC 构造 UTC 午夜，Prisma 写回 `date` 列时不产生偏移。
 */

/** date-only 字符串格式：`YYYY-MM-DD`（4-2-2 位数字）。 */
const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 校验 date-only 字符串：格式合法且对应真实存在的日历日（拒绝 2026-02-30 之类）。 */
export function isValidDueDate(s: string): boolean {
  if (!DUE_DATE_PATTERN.test(s)) return false;
  const [year, month, day] = s.split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Date（Prisma 读出的 `date` 列为 UTC 午夜）→ "YYYY-MM-DD"（基于 UTC，无时区偏移）。 */
export function toDueDateString(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * "YYYY-MM-DD" → Date（UTC 午夜）。调用方须保证入参已过 isValidDueDate / 契约 IsoDateSchema 校验；
 * 非法入参会构造出 Invalid Date，故此处显式防御性抛错，避免脏值入库。
 */
export function fromDueDateString(s: string): Date {
  if (!isValidDueDate(s)) {
    throw new RangeError(`非法的 date-only 字符串：${s}`);
  }
  const [year, month, day] = s.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day));
}
