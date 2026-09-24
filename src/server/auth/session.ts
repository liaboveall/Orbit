import "server-only";
import type { UserDTO } from "@/contracts";
import { toUserDto } from "@/server/me/read-user";
import { DomainError } from "@/server/http/errors";
import { auth } from "./index";
import { consumeReadQuota } from "./read-quota";

/**
 * 会话查询帮助函数（M1 / ORB-004）。
 *
 * 用于后续 API route / Server Component 的服务端认证检查（AGENTS.md：所有资源在服务端校验会话；
 * 组件重定向只是体验，数据安全在服务端授权）。返回契约层 UserDTO —— **不含** password /
 * session token / 内部会话字段（docs/04 §3：业务 API 永不返回认证表原始记录）。
 */

/** 取出 Headers：接受 Request（route handler）或 Headers（Server Component 的 headers()）。 */
function toHeaders(source: Request | Headers): Headers {
  return source instanceof Headers ? source : source.headers;
}

/**
 * 获取当前会话用户；未认证返回 null。
 * 历史异常资料映射为可编辑的合法显示值，不将有效身份误判为未登录。
 */
export async function getSessionUser(source: Request | Headers): Promise<UserDTO | null> {
  const headers = toHeaders(source);
  const session = await auth.api.getSession({ headers });
  if (!session) return null;

  return toUserDto(session.user);
}

/**
 * 要求已认证：返回当前用户，否则抛 401 UNAUTHENTICATED 领域错误
 * （由 HTTP 层 toErrorResponse 统一映射为标准信封）。
 */
export async function requireSessionUser(source: Request | Headers): Promise<UserDTO> {
  const user = await getSessionUser(source);
  if (!user) {
    throw new DomainError("UNAUTHENTICATED", "请先登录后再访问该资源。");
  }
  if (source instanceof Request && ["GET", "HEAD"].includes(source.method)) {
    // 与服务端页面共用每用户读取额度（见 ./read-quota 与 ./page-session）。
    const admission = await consumeReadQuota(user.id);
    // F02 修复：携带精确 resetAfter，供 Retry-After 头使用。
    if (!admission.allowed)
      throw new DomainError("RATE_LIMITED", "读取过于频繁，请稍后重试。", undefined, undefined, admission.retryAfter);
  }
  return user;
}
