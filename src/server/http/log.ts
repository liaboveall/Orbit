import "server-only";
import type { LogLevel } from "@/server/env";

const levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
/** Callers supply only explicitly selected, sanitized fields, never request/error objects. */
export function logEvent(level: LogLevel, fields: Record<string, unknown>) {
  const configured = process.env.LOG_LEVEL;
  const threshold = configured && Object.hasOwn(levels, configured)
    ? levels[configured as LogLevel] : levels.info;
  if (levels[level] < threshold) return;
  console[level](JSON.stringify({ level, ...fields }));
}
