/**
 * Calendar & Timezone Utilities (ORB-019)
 * 
 * Timezone-aware date calculations for the "My Tasks" dashboard.
 * All calculations are performed in user's timezone rather than UTC.
 * 
 * Pattern: Server Component reads user.timezone from session, then calls these helpers.
 * Client components receive pre-computed results (not raw dates) to avoid timezone drift.
 *
 * Default timezone: Asia/Shanghai（与用户注册 registrationTimezone 回退一致）。
 */
import { z } from "zod";

/** 默认时区常量（非法/空时区回退点）。 */
export const DEFAULT_TIMEZONE = "Asia/Shanghai";

/** 合理日期范围：1900-2100 年（对齐 ISO 8601 实用限制）*/
export const DATE_MIN = new Date("1900-01-01T00:00:00Z");
export const DATE_MAX = new Date("2100-12-31T23:59:59Z");

/** Zod schema：校验日期在合理范围内 */
export const validDateRangeSchema = z.string().refine(
  (dateStr) => {
    const date = new Date(dateStr);
    return !isNaN(date.getTime()) && date >= DATE_MIN && date <= DATE_MAX;
  },
  {
    message: "日期必须在 1900 年至 2100 年之间",
  },
);

/** 校验日期是否在合理范围内 */
export function isValidDateRange(dateStr: string): boolean {
  try {
    const date = new Date(dateStr);
    return !isNaN(date.getTime()) && date >= DATE_MIN && date <= DATE_MAX;
  } catch {
    return false;
  }
}

/**
 * 纯函数版本的时区校验（不依赖 server-only）
 * 用于前端校验场景
 */
export function isValidTimezonePure(timezone: string): boolean {
  if (typeof timezone !== "string") return false;
  const candidate = timezone.trim();
  if (candidate.length === 0) return false;
  
  // 拒绝裸偏移格式
  const BARE_OFFSET_PATTERN = /^[+-]\d{2}:?\d{2}$/;
  if (BARE_OFFSET_PATTERN.test(candidate)) return false;
  
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a date is overdue based on user's timezone
 * Overdue = dueDate < todayInUserTimezone AND status !== DONE
 * 
 * @param dueDate - The task's due date (YYYY-MM-DD format or Date object); null returns false
 * @param userTimezone - User's IANA timezone (e.g., "America/New_York"); defaults to Asia/Shanghai if invalid
 * @param now - Current timestamp for testing; default new Date()
 * @returns true if overdue, false otherwise
 */
export function isOverdue(
  dueDate: string | Date | null,
  userTimezone: string,
  now: Date = new Date()
): boolean {
  if (!dueDate) return false; // null/undefined always not overdue
  
  const effectiveTz = isValidTimezonePure(userTimezone) ? userTimezone : DEFAULT_TIMEZONE;
  const deadline = parseToDate(dueDate);
  const today = getTodayInTimezone(effectiveTz, now);
  
  // Compare dates without time component
  const deadlineOnly = formatDateOnly(deadline);
  const todayOnly = formatDateOnly(today);
  
  return deadlineOnly < todayOnly;
}

/**
 * Check if a date is due today (in user's timezone)
 * @param dueDate - The task's due date; null returns false
 * @param userTimezone - User's IANA timezone; defaults to Asia/Shanghai if invalid
 * @param now - Current timestamp for testing; default new Date()
 * @returns true if due today, false otherwise
 */
export function isDueToday(dueDate: string | Date | null, userTimezone: string, now: Date = new Date()): boolean {
  if (!dueDate) return false; // null always not due today
  
  const effectiveTz = isValidTimezonePure(userTimezone) ? userTimezone : DEFAULT_TIMEZONE;
  
  const deadline = parseToDate(dueDate);
  const today = getTodayInTimezone(effectiveTz, now);
  
  return formatDateOnly(deadline) === formatDateOnly(today);
}

/**
 * Check if a date is due within the next 7 days (inclusive of today)
 * @param dueDate - The task's due date; null returns false
 * @param userTimezone - User's IANA timezone; defaults to Asia/Shanghai if invalid
 * @param now - Current timestamp for testing; default new Date()
 * @returns true if due within 7 days, false otherwise
 */
export function isDueWithinWeek(
  dueDate: string | Date | null,
  userTimezone: string,
  now: Date = new Date()
): boolean {
  if (!dueDate) return false; // null always not due
  
  const effectiveTz = isValidTimezonePure(userTimezone) ? userTimezone : DEFAULT_TIMEZONE;
  
  const deadline = parseToDate(dueDate);
  const today = getTodayInTimezone(effectiveTz, now);
  const weekLater = addDays(today, 7);
  
  const deadlineOnly = formatDateOnly(deadline);
  const todayOnly = formatDateOnly(today);
  const weekLaterOnly = formatDateOnly(weekLater);
  
  return deadlineOnly >= todayOnly && deadlineOnly <= weekLaterOnly;
}

export function getTodayString(timezone: string, now: Date = new Date()): string {
  if (!isValidTimezonePure(timezone)) {
    return formatDateOnly(new Date(getTodayInTimezone(DEFAULT_TIMEZONE, now)));
  }
  
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
    calendar: "gregory",
  };
  
  const formatter = new Intl.DateTimeFormat("en-CA", options);
  const parts = formatter.formatToParts(now);
    
  // Extract date components from parts
  let yearStr = "";
  let monthStr = "";
  let dayStr = "";
  
  for (const part of parts) {
    if (part.type === "year") yearStr = part.value as string;
    else if (part.type === "month") monthStr = part.value as string;
    else if (part.type === "day") dayStr = part.value as string;
  }
  
  // If any component missing, fallback to DEFAULT_TIMEZONE
  if (!yearStr || !monthStr || !dayStr) {
    return formatDateOnly(new Date(getTodayInTimezone(DEFAULT_TIMEZONE, now)));
  }
  
  const month = Number(monthStr).toString().padStart(2, "0");
  const day = Number(dayStr).toString().padStart(2, "0");
    
  return `${yearStr}-${month}-${day}`;
}

/**
 * Parse various date formats to Date object
 */
function parseToDate(input: string | Date | null): Date {
  if (!input) return new Date(0);
  if (input instanceof Date) return input;
  
  // Input is YYYY-MM-DD, so midnight UTC
  const [yearStr, monthStr, dayStr] = input.split("-").map(Number);
  if (yearStr === undefined || monthStr === undefined || dayStr === undefined) {
    return new Date(0);
  }
  return new Date(Date.UTC(yearStr, monthStr - 1, dayStr));
}

/**
 * Format a Date object to YYYY-MM-DD string
 */
export function formatDateOnly(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get today's Date object in user's timezone (for database queries)
 * @param timezone - User's IANA timezone; defaults to Asia/Shanghai if invalid
 * @param now - Current timestamp for testing; default new Date()
 */
export function getTodayInTimezone(timezone: string, now: Date = new Date()): Date {
  const effectiveTz = isValidTimezonePure(timezone) ? timezone : DEFAULT_TIMEZONE;
  
  const todayStr = getTodayString(effectiveTz, now);
  return parseToDate(todayStr);
}

/**
 * Add days to a Date object
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Get the difference in days between two dates
 */
export function getDaysDifference(from: Date, to: Date): number {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const diffMs = toMs - fromMs;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/** @deprecated Use getTodayString() instead */
export function dateInTimezone(timezone: string, now = new Date()): string {
  return getTodayString(timezone, now);
}
