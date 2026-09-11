import "server-only";
import { isIP } from "node:net";
import { getEnv } from "@/server/env";
const FALLBACK = "__no-trusted-proxy__";
/** Enable only behind the configured proxy chain with direct origin access blocked.
 * Proxies append the peer address; client-supplied prefixes are not trusted. */
export function resolveClientIp(forwardedFor?: string, trustedProxyCount?: number): string {
  const count = trustedProxyCount ?? getEnv().TRUSTED_PROXY_COUNT;
  if (!Number.isInteger(count) || count <= 0 || !forwardedFor) return FALLBACK;
  const chain = forwardedFor.split(",").map(value => value.trim());
  if (chain.length < count || chain.some(value => !value)) return FALLBACK;
  const candidate = chain[chain.length - count]!;
  
  // 先检测 IPv4-mapped IPv6 格式 (::ffff:x.x.x.x)
  const mapped = /^::ffff:([\d{1,3}\.]+)$/.exec(candidate);
  if (mapped) {
    const ipv4 = mapped[1]!;
    const parts = ipv4.split(".").map(Number);
    if (parts.every(p => Number.isInteger(p) && p >= 0 && p <= 255)) {
      return ipv4;
    }
  }
  
  // 标准 IPv4
  if (isIP(candidate) === 4) return candidate;
  
  // IPv6
  if (isIP(candidate) !== 6 || candidate.includes("%")) return FALLBACK;
  const canonical = new URL(`http://[${candidate}]/`).hostname.slice(1, -1);
  return canonical;
}
