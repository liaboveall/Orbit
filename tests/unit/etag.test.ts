import { describe, expect, it } from "vitest";
import { ifNoneMatchSatisfied, toEtag } from "@/server/http/etag";

/**
 * If-None-Match 弱比较（RFC 9110 §13.1.2）：GET /my/pulse 据此决定 200 还是 304。
 */
describe("ifNoneMatchSatisfied", () => {
  const etag = toEtag("0123456789abcdef");

  it("wraps the token in quotes", () => {
    expect(etag).toBe('"0123456789abcdef"');
  });

  it("matches the exact validator", () => {
    expect(ifNoneMatchSatisfied('"0123456789abcdef"', etag)).toBe(true);
  });

  it("ignores the weak prefix on either side", () => {
    expect(ifNoneMatchSatisfied('W/"0123456789abcdef"', etag)).toBe(true);
    expect(ifNoneMatchSatisfied('"0123456789abcdef"', `W/${etag}`)).toBe(true);
  });

  it("matches any member of a list and tolerates whitespace", () => {
    expect(ifNoneMatchSatisfied('"aaaa" ,  W/"0123456789abcdef", "bbbb"', etag)).toBe(true);
  });

  it("matches the wildcard", () => {
    expect(ifNoneMatchSatisfied("*", etag)).toBe(true);
  });

  it("does not match a different, unquoted or partial validator", () => {
    expect(ifNoneMatchSatisfied('"fedcba9876543210"', etag)).toBe(false);
    expect(ifNoneMatchSatisfied("0123456789abcdef", etag)).toBe(false);
    expect(ifNoneMatchSatisfied('"0123456789abcde"', etag)).toBe(false);
  });

  it("treats a missing or empty header as no condition", () => {
    expect(ifNoneMatchSatisfied(null, etag)).toBe(false);
    expect(ifNoneMatchSatisfied("", etag)).toBe(false);
    expect(ifNoneMatchSatisfied(" , ", etag)).toBe(false);
  });
});
