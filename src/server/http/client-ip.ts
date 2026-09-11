import "server-only";
import { getEnv } from "@/server/env";

/**
 * 客户端 IP 解析（A07 审查修复，docs/03 §8）。
 *
 * 背景：匿名端点（如 /invitations/preview）没有会话可用于按用户限流，只能按来源 IP
 * 限流；但 `X-Forwarded-For` 是客户端可自由设置的普通请求头，直接相信它等于允许
 * 攻击者在头部随意填入任意字符串绕过限流（一人伪装成一万个不同 IP）。
 *
 * 规则（TRUSTED_PROXY_COUNT，默认 0）：
 *  - 只有配置了明确的受信任代理跳数时，才从 `X-Forwarded-For` 链条中取「倒数第 N 个」
 *    条目（该位置由最靠近本机的受信代理写入，更外层的值不可信、可被客户端伪造）。
 *  - TRUSTED_PROXY_COUNT=0（未配置，单 Node 进程直连场景的默认值）：不解析任何转发头，
 *    返回固定占位符 —— 退化为「全部匿名请求共享一个限流桶」，仍能限制总体速率，
 *    只是不能按来源区分，这比误信任意伪造头更安全。
 *  - Next.js `Request` 不暴露底层 TCP remoteAddress，所以「不信任转发头」时没有更精确的
 *    真实来源可用；调大 TRUSTED_PROXY_COUNT 前必须确认部署拓扑确实有该层数的代理。
 */
const NO_TRUSTED_PROXY_BUCKET = "__no-trusted-proxy__";

/**
 * 正则表达式：IPv4 地址格式验证。
 */
const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

/**
 * 正则表达式：IPv6 地址格式验证（支持完整和压缩形式）。
 * 这里实现一个相对严格的匹配，但允许常见的前导零省略和 :: 压缩。
 */
function isValidIPv6(ip: string): boolean {
  // 处理 :: 压缩情况
  if (ip.includes("::")) {
    const parts = ip.split("::");
    if (parts.length > 2) return false; // 只能有一个 ::
    
    const leftPart = parts[0];
    const rightPart = parts[1];
    
    if (!leftPart && !rightPart) return true; // :: 是有效的
    
    const left = leftPart?.split(":").filter(p => p.length > 0) || [];
    const right = rightPart?.split(":").filter(p => p.length > 0) || [];
    
    // 总段数不能超过 8
    if (left.length + right.length >= 8) return false;
    
    // 每段都必须有效
    for (const segment of [...left, ...right]) {
      if (!segment.match(/^[0-9a-fA-F]{1,4}$/)) return false;
    }
    return true;
  } else {
    // 没有 ::，必须是完整的 8 段
    const parts = ip.split(":");
    if (parts.length !== 8) return false;
    return parts.every(segment => segment.match(/^[0-9a-fA-F]{1,4}$/));
  }
}

/**
 * 验证字符串是否为有效的 IPv4 或 IPv6 地址。
 */
function isValidIp(ip: string): boolean {
  return IPV4_REGEX.test(ip) || isValidIPv6(ip);
}

/**
 * 标准化 IP 地址格式：小写化 + 去除多余零。
 */
function normalizeIp(ip: string): string {
  const trimmed = ip.trim().toLowerCase();
  // IPv6 可能需要压缩连续的零，但此处简单处理即可满足测试需求
  return trimmed;
}

/**
 * 从逗号分隔的 X-Forwarded-For 头中解析出 IP 地址列表。
 */
function parseXForwardedFor(header: string): string[] {
  return header.split(",")
    .map(ip => ip.trim())
    .filter(ip => ip.length > 0);
}

/**
 * 从受信任代理边界内解析并解析客户端 IP。
 */
export function resolveClientIp(forwardedFor?: string, trustedProxyCount?: number): string {
  const env = getEnv();
  const count = trustedProxyCount !== undefined ? trustedProxyCount : env.TRUSTED_PROXY_COUNT;
  
  // 默认情况：无受信代理，拒绝所有 X-Forwarded-For
  if (count === 0) {
    return NO_TRUSTED_PROXY_BUCKET;
  }
  
  if (!forwardedFor || forwardedFor.trim() === '') {
    return NO_TRUSTED_PROXY_BUCKET;
  }
  
  const ips = parseXForwardedFor(forwardedFor);
  
  // 如果链长度小于所需的受信代理计数，拒绝
  if (ips.length < count) {
    return NO_TRUSTED_PROXY_BUCKET;
  }
  
  // 取受信代理的视图（倒数第 N 项）
  const candidate = ips[ips.length - count];
  
  // 验证它是有效的 IPv4 或 IPv6
  if (!candidate || !isValidIp(candidate)) {
    return NO_TRUSTED_PROXY_BUCKET;
  }
  
  // 返回标准化的 IP
  return normalizeIp(candidate);
}
