import { sanitizeReturnTo } from "./return-to";

/**
 * 页面读取超额后的说明页地址（PAGE-READ-LIMIT）。纯函数，服务端准入与说明页共用。
 *
 * returnTo 仍只允许同源相对路径（sanitizeReturnTo），并去掉 RSC 请求内部的 `_rsc`
 * 查询参数，得到用户可见的原页面地址。
 */

export const RATE_LIMITED_PATH = "/rate-limited";

/** 默认恢复等待秒数（与读取桶一分钟窗口一致）。 */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

export function visiblePagePath(raw: string | null | undefined): string {
  const url = new URL(sanitizeReturnTo(raw), "http://orbit.internal");
  url.searchParams.delete("_rsc");
  return `${url.pathname}${url.search}${url.hash}`;
}

function retryAfterSeconds(value: unknown): number {
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= 3600 ? seconds : DEFAULT_RETRY_AFTER_SECONDS;
}

export function rateLimitedPath(returnTo: string, retryAfter: number): string {
  const params = new URLSearchParams({
    retryAfter: String(retryAfterSeconds(retryAfter)),
    returnTo: visiblePagePath(returnTo),
  });
  return `${RATE_LIMITED_PATH}?${params.toString()}`;
}

export function parseRateLimitedParams(params: Record<string, string | string[] | undefined>): {
  retryAfter: number;
  returnTo: string;
} {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return {
    retryAfter: retryAfterSeconds(first(params.retryAfter)),
    returnTo: visiblePagePath(first(params.returnTo)),
  };
}
