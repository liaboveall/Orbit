import "server-only";
import { getEnv } from "@/server/env";
import { errorResponse } from "./errors";

/**
 * Origin 边界校验（M1 / ORB-004）。
 *
 * 适用范围：**自有变更 API**（/api/v1/* 的写操作）。docs/03 §5：所有自有变更 API 仅接受同源
 * 浏览器请求，检查 Origin 与配置的可信源；缺失/不匹配一律拒绝。
 *
 * ⚠️ 不用于 Better Auth 自有路由（/api/auth/*）——库内置 CSRF / trustedOrigins 控制，
 * 再包一层会破坏其回调（docs/03 §5：不包一层破坏回调的自制逻辑）。
 *
 * 规则：
 *  - GET / HEAD / OPTIONS（安全或预检方法）不检查 Origin。
 *  - 其它方法：Origin 必须存在且**精确**命中 AUTH_TRUSTED_ORIGINS 白名单（env 校验已拒绝通配符）。
 *  - 不满足 → 403 ORIGIN_NOT_ALLOWED（标准信封）。
 */

/** 不检查 Origin 的方法（安全方法 + CORS 预检）。 */
const ORIGIN_EXEMPT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * 归一化 Origin：借 `new URL(raw).origin` 自动去尾斜杠、host 小写、剥离 path/查询，
 * 使 `http://localhost:3000/` 与 `http://localhost:3000` 视为同一个源。非法值返回 null。
 */
function normalizeOrigin(raw: string): string | null {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** 解析可信源白名单（逗号分隔，逐项归一化后精确匹配）。 */
function trustedOrigins(): string[] {
  return getEnv()
    .AUTH_TRUSTED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(normalizeOrigin)
    .filter((o): o is string => o !== null);
}

/** 纯判断：Origin 是否在白名单内（缺失/非法视为不允许；两侧均归一化后精确比较）。 */
export function isOriginAllowed(origin: string | null, allowed: readonly string[]): boolean {
  const normalized = origin ? normalizeOrigin(origin) : null;
  if (!normalized) return false;
  return allowed.some((entry) => normalizeOrigin(entry) === normalized);
}

/**
 * 校验请求 Origin。合法（或方法豁免）返回 null；否则返回 403 ORIGIN_NOT_ALLOWED 响应。
 * 调用方：`const denied = verifyRequestOrigin(req, requestId); if (denied) return denied;`
 */
export function verifyRequestOrigin(request: Request, requestId: string): Response | null {
  if (ORIGIN_EXEMPT_METHODS.has(request.method.toUpperCase())) {
    return null;
  }
  const origin = request.headers.get("origin");
  if (isOriginAllowed(origin, trustedOrigins())) {
    return null;
  }
  return errorResponse(
    "ORIGIN_NOT_ALLOWED",
    "请求来源不受信任，请在应用内重试。",
    requestId,
  );
}
