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
  
  // Validate the complete address before canonicalizing; never parse malformed octets.
  if (isIP(candidate) === 4) return candidate;
  
  // IPv6
  if (isIP(candidate) !== 6 || candidate.includes("%")) return FALLBACK;
  const canonical = new URL(`http://[${candidate}]/`).hostname.slice(1, -1);
  // WHATWG URL emits mapped IPv6 in hexadecimal, regardless of the input notation.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (mapped) {
    const high = Number.parseInt(mapped[1]!, 16);
    const low = Number.parseInt(mapped[2]!, 16);
    return [high >>> 8, high & 255, low >>> 8, low & 255].join(".");
  }
  return canonical;
}
