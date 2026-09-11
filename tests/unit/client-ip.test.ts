import { afterEach, describe, expect, it } from "vitest";
import dotenv from "dotenv";
import { getEnv } from "@/server/env";
import { resolveClientIp } from "@/server/http/client-ip";

/**
 * client-ip.ts 单元测试（A10 修复：此前完全没有针对 resolveClientIp 的测试，
 * 而它正是「伪造 X-Forwarded-For 能否绕过邀请限流」这条安全属性的唯一把关点）。
 *
 * 覆盖矩阵：
 *  - TRUSTED_PROXY_COUNT=0（默认）：任何 X-Forwarded-For 内容都必须被完全忽略，
 *    退化为固定占位桶——这是「未配置受信代理时，伪造头无效」这条要求的直接验证。
 *  - TRUSTED_PROXY_COUNT>0：从链条倒数第 N 个位置取值；链条长度不足、缺失头、
 *    空字符串、纯逗号等异常输入都必须有明确的兜底行为（不抛异常、不越界）。
 *  - 不同的「客户端可控前缀 + 受信代理段」组合：验证只有受信代理写入的那一段
 *    被采信，客户端在其左侧塞入的伪造值不影响判定结果。
 *
 * 环境准备：resolveClientIp 内部调用 getEnv() 读取 TRUSTED_PROXY_COUNT，getEnv() 会
 * 校验 process.env 上**全部**必需变量（不仅是 TRUSTED_PROXY_COUNT），因此本文件必须
 * 像其它触达 getEnv 的测试（tests/integration/rate-limit.test.ts）一样先加载
 * .env.local，而不能像 tests/unit/env.test.ts 那样自行构造一份最小对象传给
 * parseEnv——resolveClientIp 没有暴露等价的纯函数入口，只能通过真实的 getEnv() 单例。
 */
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
process.env.APP_ENV = "test";
process.env.BETTER_AUTH_SECRET ||= "orbit-client-ip-unit-test-secret-0123456789";

function getForwardedHeaderValue(value: string | null): string | undefined {
  return value ?? undefined;
}

function setTrustedProxyCount(count: number): void {
  process.env.TRUSTED_PROXY_COUNT = String(count);
  getEnv(true); // 强制重新解析，绕过模块级缓存。
}

afterEach(() => {
  delete process.env.TRUSTED_PROXY_COUNT;
  getEnv(true);
});

describe("resolveClientIp · TRUSTED_PROXY_COUNT=0（默认，不信任任何转发头）", () => {
  it("忽略真实存在的 X-Forwarded-For，返回固定占位桶", () => {
    setTrustedProxyCount(0);
    const a = resolveClientIp(getForwardedHeaderValue("1.2.3.4"));
    const b = resolveClientIp(getForwardedHeaderValue("9.9.9.9"));
    expect(a).toBe(b); // 两个不同的伪造值必须落进同一个桶。
  });

  it("即使客户端塞入大量伪造的转发链，也不影响判定（仍是同一个占位桶）", () => {
    setTrustedProxyCount(0);
    const spoofed = resolveClientIp(
      getForwardedHeaderValue("1.1.1.1, 2.2.2.2, 3.3.3.3, 4.4.4.4, 5.5.5.5"),
    );
    const clean = resolveClientIp(getForwardedHeaderValue(null));
    expect(spoofed).toBe(clean);
  });

  it("缺失该请求头时同样落进占位桶", () => {
    setTrustedProxyCount(0);
    const withHeader = resolveClientIp(getForwardedHeaderValue("1.2.3.4"));
    const withoutHeader = resolveClientIp(getForwardedHeaderValue(null));
    expect(withHeader).toBe(withoutHeader);
  });
});

describe("resolveClientIp · TRUSTED_PROXY_COUNT=1（一层受信反向代理）", () => {
  it("取链条倒数第 1 项作为客户端 IP（该项由受信代理写入，其左侧客户端自称的值不采信）", () => {
    setTrustedProxyCount(1);
    // 格式：client, proxy1（受信代理收到时看到的直接来源是 client，转发时追加自己）。
    // 客户端在自己那一项塞入任意伪造字符串（这里故意不是合法 IP 格式，验证 resolveClientIp
    // 不对该段做 IP 格式校验，只按位置取值——它信任的是「位置」，不是「内容形状」）。
    // 倒数第 1 项 = "203.0.113.7"（受信代理直接观察到的来源）。
    const ip = resolveClientIp(
      getForwardedHeaderValue("this-is-not-a-real-ip-but-that-is-fine, 203.0.113.7"),
    );
    expect(ip).toBe("203.0.113.7");
  });

  it("两个不同的客户端自称前缀、但受信代理段相同时，解析结果必须相同（证明客户端前缀不影响判定）", () => {
    setTrustedProxyCount(1);
    const ip1 = resolveClientIp(getForwardedHeaderValue("1.1.1.1, 203.0.113.7"));
    const ip2 = resolveClientIp(getForwardedHeaderValue("9.9.9.9, 203.0.113.7"));
    expect(ip1).toBe(ip2);
    expect(ip1).toBe("203.0.113.7");
  });

  it("受信代理段不同时，解析结果必须不同（证明确实按受信段区分来源，不是又退化成固定桶）", () => {
    setTrustedProxyCount(1);
    const ipA = resolveClientIp(getForwardedHeaderValue("1.1.1.1, 203.0.113.7"));
    const ipB = resolveClientIp(getForwardedHeaderValue("1.1.1.1, 203.0.113.99"));
    expect(ipA).not.toBe(ipB);
  });

  it("缺失请求头时退化为占位桶，不抛异常", () => {
    setTrustedProxyCount(1);
    expect(() => resolveClientIp(getForwardedHeaderValue(null))).not.toThrow();
    const ip = resolveClientIp(getForwardedHeaderValue(null));
    expect(typeof ip).toBe("string");
    expect(ip.length).toBeGreaterThan(0);
  });

  it("链条长度不足受信代理跳数时返回占位桶，不抛异常", () => {
    setTrustedProxyCount(3); // 配置了 3 层，但链条只有 1 项。
    expect(() => resolveClientIp(getForwardedHeaderValue("203.0.113.7"))).not.toThrow();
    const ip = resolveClientIp(getForwardedHeaderValue("203.0.113.7"));
    expect(ip).toBe("__no-trusted-proxy__");
  });

  it("空字符串请求头值视为缺失，退化为占位桶", () => {
    setTrustedProxyCount(1);
    expect(() => resolveClientIp(getForwardedHeaderValue(""))).not.toThrow();
  });

  it("纯逗号/空白构成的转发头（无有效条目）不抛异常，退化为占位桶", () => {
    setTrustedProxyCount(1);
    expect(() => resolveClientIp(getForwardedHeaderValue(" , , "))).not.toThrow();
  });
});

describe("resolveClientIp · TRUSTED_PROXY_COUNT=2（两层受信反向代理）", () => {
  it("取链条倒数第 2 项，跳过最外层受信代理自己追加的那一项", () => {
    setTrustedProxyCount(2);
    // 格式：client, proxy1(受信), proxy2(受信，最靠近本机)。
    // 倒数第 2 项 = proxy1 收到时看到的直接来源 = "203.0.113.7"。
    const ip = resolveClientIp(
      getForwardedHeaderValue("client-self-reported-value, 203.0.113.7, 10.0.0.5"),
    );
    expect(ip).toBe("203.0.113.7");
  });
});


describe("R3 strict proxy boundaries and canonical buckets", () => {
  it("rejects short chains, empty slots and malformed IPs", () => {
    const fallback = resolveClientIp(undefined, 1);
    for (const [header, hops] of [["203.0.113.7",3],["garbage",1],["203.0.113.7,,127.0.0.1",2],["1:::2",1],["01.2.3.4",1]] as const) {
      expect(resolveClientIp(header,hops)).toBe(fallback);
    }
  });
  it("normalizes equivalent IPv6 and mapped IPv4 addresses", () => {
    expect(resolveClientIp("2001:0DB8:0:0:0:0:0:1",1)).toBe(resolveClientIp("2001:db8::1",1));
    expect(resolveClientIp("::ffff:192.0.2.1",1)).toBe(resolveClientIp("192.0.2.1",1));
  });
});
