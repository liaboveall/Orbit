/**
 * returnTo 安全校验（M1 / ORB-005，防开放重定向）。
 *
 * 放在 lib/（跨功能纯工具、无服务端依赖、无 server-only）：
 * 既被 Edge middleware（src/middleware.ts）复用，也被认证 UI（features/auth）复用。
 *
 * 威胁模型（docs/01 FR-AUTH、docs/03 §8）：登录/验证完成后按 returnTo 跳转，
 * 若不校验会被利用为开放重定向（钓鱼）。**只允许同源相对路径**，拒绝：
 *  - 绝对 URL（`https://evil.com`、`http://evil.com`）——不以 `/` 开头即拒；
 *  - 协议相对（`//evil.com`）——浏览器会补全为跨源；
 *  - 反斜杠绕过（`/\evil.com`、`\\evil.com`）——部分浏览器把 `\` 视作 `/`；
 *  - `javascript:` / `data:` 等伪协议——不以 `/` 开头即拒；
 *  - 含控制字符/空白注入的畸形值。
 * 不合法一律回退到 DEFAULT_RETURN_TO。
 */

/** 登录/验证成功后的默认落地页。 */
export const DEFAULT_RETURN_TO = "/app/today";
/** Proxy 覆写的当前请求路径，供应用布局在失效 Cookie 时保留 returnTo。 */
export const REQUEST_RETURN_TO_HEADER = "x-orbit-return-to";

/** 用于把相对路径解析成 URL 的哑基址（仅比较 origin 是否被篡改，绝不用于真实跳转）。 */
const DUMMY_BASE = "http://orbit.internal";

/**
 * 校验并规范化 returnTo，返回一个**保证同源**的相对路径（含可选 search/hash）。
 *
 * @param raw 来自 URL 查询参数等的原始值（可能为 null/undefined/畸形）。
 * @param fallback 校验失败时的回退路径（默认 /app/today），本身也必须是同源相对路径。
 */
export function sanitizeReturnTo(
  raw: string | null | undefined,
  fallback: string = DEFAULT_RETURN_TO,
): string {
  const safe = toSafeRelativePath(raw);
  return safe ?? toSafeRelativePath(fallback) ?? DEFAULT_RETURN_TO;
}

/**
 * 判断一个字符串是否为「安全的同源相对路径」。是则返回规范化后的路径，否则返回 null。
 * 规范化：仅保留 pathname + search + hash，剥离任何可能被解析出的 host/协议。
 */
function toSafeRelativePath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;

  const value = raw.trim();
  if (value.length === 0) return null;

  // 必须以单个 "/" 开头（拒绝绝对 URL、伪协议、协议相对）。
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null; // 协议相对 //evil.com
  if (value.startsWith("/\\")) return null; // /\evil.com 会被当作协议相对
  // 拒绝任何反斜杠（避免 `\/`、`\\`、编码绕过被下游规范化为跨源）。
  if (value.includes("\\")) return null;
  // 拒绝控制字符与换行（HTTP 头/重定向注入）。
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;

  // 用哑基址解析，确认 origin 未被篡改，并取出纯净的 pathname+search+hash。
  try {
    const url = new URL(value, DUMMY_BASE);
    if (url.origin !== DUMMY_BASE) return null;
    const normalized = `${url.pathname}${url.search}${url.hash}`;
    if (!normalized.startsWith("/") || normalized.startsWith("//")) return null;
    return normalized;
  } catch {
    return null;
  }
}

/**
 * 构造带 returnTo 的登录跳转路径（供 middleware / 受保护页使用）。
 * returnTo 会先经 sanitizeReturnTo 校验，再 encodeURIComponent，杜绝把非法值透传下去。
 */
export function loginPathWithReturnTo(currentPath: string): string {
  const safe = sanitizeReturnTo(currentPath);
  return `/auth/login?returnTo=${encodeURIComponent(safe)}`;
}
