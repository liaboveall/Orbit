import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import type { ErrorResponse } from "@/contracts";
import { REQUEST_RETURN_TO_HEADER, loginPathWithReturnTo } from "@/lib/return-to";

/** Cookie 存在性仅用于快速门禁；真实会话由页面和 API 在服务端校验。 */

/** 承载 requestId 的头名称（与 src/server/http/request-id.ts 保持一致）。 */
const REQUEST_ID_HEADER = "x-request-id";

/** 授权/私有响应缓存策略：禁止任何共享缓存存储（与 HTTP 层 NO_STORE 一致）。 */
const NO_STORE = "private, no-store";

/** requestId 合法字符集与长度（回显上游值前清洗，防头注入；UUID 天然匹配）。 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * 解析 requestId：优先复用上游合法值以保持链路连续，否则用 crypto.randomUUID 生成。
 */
function resolveRequestId(headers: Headers): string {
  const incoming = headers.get(REQUEST_ID_HEADER);
  if (incoming && REQUEST_ID_PATTERN.test(incoming)) return incoming;
  return crypto.randomUUID();
}

/** /api/v1/* 未认证：返回 401 JSON 标准信封（不重定向，供 API 客户端消费）。 */
function unauthenticatedJson(request: NextRequest): NextResponse {
  const requestId = resolveRequestId(request.headers);
  const body: ErrorResponse = {
    error: { code: "UNAUTHENTICATED", message: "请先登录后再访问该资源。" },
    meta: { requestId },
  };
  return NextResponse.json(body, {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": NO_STORE,
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  // 仅检测 session cookie 是否存在（不校验有效性；由下游服务端授权负责）。
  const isAuthenticated = getSessionCookie(request) !== null;

  // 1) /api/v1/*：需要认证。未登录返回 401 JSON（不重定向，API 语义）。
  //    排除匿名端点：邀请预览不要求认证（openapi security:[]）。
  if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
    if (pathname === "/api/v1/invitations/preview") {
      return NextResponse.next();
    }
    if (!isAuthenticated) return unauthenticatedJson(request);
    return NextResponse.next();
  }

  // 2) /app/*：需要认证。未登录重定向到 /auth/login?returnTo=<当前路径含查询>（returnTo 不含私有数据）。
  if (pathname === "/app" || pathname.startsWith("/app/")) {
    if (!isAuthenticated) {
      const target = loginPathWithReturnTo(`${pathname}${search}`);
      return NextResponse.redirect(new URL(target, request.url));
    }
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(REQUEST_RETURN_TO_HEADER, `${pathname}${search}`);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // 登录/注册页自行检查真实会话；绝不按 Cookie 存在性阻止重新登录。
  return NextResponse.next();
}

/**
 * 只在需要保护的前缀上运行：
 *  - /app/*（受保护页面）、/api/v1/*（受保护 API）；/auth/* 页面**不在**拦截范围——
 *    登录/注册/验证页自行检查真实会话并回跳（上面的 return NextResponse.next() 分支），
 *    不按 Cookie 存在性做任何改写。
 *  - **不含** /api/auth/*（Better Auth catch-all 自管理，含限流/会话/邮件端点，绝不拦截）。
 *  - 不含静态资源与根路径，减少无谓执行。
 */
export const config = {
  // Next 16.3 Proxy buffers the entire body before invoking route handlers.
  // Multipart endpoints must reach their session/admission checks BEFORE body
  // reception; both GET/POST retain authoritative authentication in the route.
  matcher: ["/app/:path*", "/auth/:path*", "/api/v1/((?!tasks/[^/]+/attachments/?$).*)"],
};
