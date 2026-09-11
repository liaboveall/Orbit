import "server-only";
import { APIError } from "better-auth/api";
import { normalizeTimezone } from "@/server/me/timezone";

export const DEFAULT_TIMEZONE = "Asia/Shanghai";

/** 所有认证库用户写入口与 /me 使用相同的姓名规则。 */
export function requireUserName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > 40) {
    throw new APIError("BAD_REQUEST", { code: "INVALID_NAME", message: "姓名需为 1—40 个字符。" });
  }
  return value.trim();
}

export function registrationTimezone(value: unknown): string {
  return typeof value === "string" ? normalizeTimezone(value) ?? DEFAULT_TIMEZONE : DEFAULT_TIMEZONE;
}

export function requireUserTimezone(value: unknown): string {
  const timezone = typeof value === "string" ? normalizeTimezone(value) : null;
  if (!timezone) {
    throw new APIError("BAD_REQUEST", { code: "INVALID_TIMEZONE", message: "时区须为合法 IANA 标识。" });
  }
  return timezone;
}
