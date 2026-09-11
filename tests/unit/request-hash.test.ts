import { describe, expect, it } from "vitest";
import { hashRequest } from "@/server/modules/idempotency/service";

/**
 * 幂等请求指纹单元测试（M2 / ORB-007，docs/05 §5「规范化请求」）。
 *
 * hashRequest = SHA-256(stableStringify(body))，核心保证：
 *  - 键序无关：{a,b} 与 {b,a} 指纹一致（否则同一逻辑请求会被误判为冲突）；
 *  - 内容敏感：值不同则指纹不同；
 *  - 嵌套递归排序、数组保序、空对象稳定。
 */

describe("hashRequest — 幂等请求指纹", () => {
  it("返回 64 位小写十六进制 SHA-256", () => {
    const hash = hashRequest({ name: "Orbit" });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("键序无关：顶层字段书写顺序不同，指纹一致", () => {
    expect(hashRequest({ a: 1, b: 2 })).toBe(hashRequest({ b: 2, a: 1 }));
  });

  it("键序无关：多字段乱序，指纹一致", () => {
    const h1 = hashRequest({ key: "ORB", name: "Orbit", description: "d", color: "BLUE" });
    const h2 = hashRequest({ color: "BLUE", description: "d", name: "Orbit", key: "ORB" });
    expect(h1).toBe(h2);
  });

  it("内容敏感：值不同则指纹不同", () => {
    expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ a: 2 }));
    expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ b: 1 }));
  });

  it("空对象稳定且与非空不同", () => {
    const empty = hashRequest({});
    expect(empty).toMatch(/^[0-9a-f]{64}$/);
    expect(empty).toBe(hashRequest({}));
    expect(empty).not.toBe(hashRequest({ a: 1 }));
  });

  it("嵌套对象键序无关（递归排序）", () => {
    const h1 = hashRequest({ outer: { x: 1, y: { p: 1, q: 2 } } });
    const h2 = hashRequest({ outer: { y: { q: 2, p: 1 }, x: 1 } });
    expect(h1).toBe(h2);
  });

  it("数组保序：顺序不同视为不同请求（数组顺序有意义）", () => {
    expect(hashRequest({ list: [1, 2, 3] })).toBe(hashRequest({ list: [1, 2, 3] }));
    expect(hashRequest({ list: [1, 2, 3] })).not.toBe(hashRequest({ list: [3, 2, 1] }));
  });

  it("数组内对象仍按键排序", () => {
    expect(hashRequest({ list: [{ a: 1, b: 2 }] })).toBe(hashRequest({ list: [{ b: 2, a: 1 }] }));
  });

  it("undefined 值字段被跳过（与 JSON.stringify 语义一致）", () => {
    expect(hashRequest({ a: 1, b: undefined })).toBe(hashRequest({ a: 1 }));
  });

  it("null 与缺省不同（null 是显式值）", () => {
    expect(hashRequest({ a: null })).not.toBe(hashRequest({}));
  });
});
