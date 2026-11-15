import { describe, expect, it } from "vitest";
import { isOutdated, parsePulse, type Pulse } from "@/features/shell/pulse";

/** 页面保鲜的令牌解析与比较（features/shell/pulse.ts）。 */

const pulse = (token: string, projects: Record<string, string>, shell = "s1"): Pulse => ({ token, shell, projects });

describe("parsePulse", () => {
  it("解析标准信封", () => {
    expect(
      parsePulse({ data: { token: "t", shell: "s", projects: [{ id: "p1", token: "a" }, { id: "p2", token: "b" }] }, meta: { requestId: "r" } }),
    ).toEqual({ token: "t", shell: "s", projects: { p1: "a", p2: "b" } });
  });

  it("没有项目时得到空映射", () => {
    expect(parsePulse({ data: { token: "t", shell: "s", projects: [] } })).toEqual({ token: "t", shell: "s", projects: {} });
  });

  it.each([
    null,
    "text",
    {},
    { data: null },
    { data: { token: 1, shell: "s", projects: [] } },
    { data: { token: "t", projects: [] } },
    { data: { token: "t", shell: "s", projects: {} } },
    { data: { token: "t", shell: "s", projects: [{ id: "p1" }] } },
    { data: { token: "t", shell: "s", projects: [null] } },
    { error: { code: "RATE_LIMITED", message: "x" } },
  ])("形状不对返回 null：%j", (value) => {
    expect(parsePulse(value)).toBeNull();
  });
});

describe("isOutdated", () => {
  const applied = pulse("t1", { p1: "a", p2: "b" });

  it("还没有可比较的令牌，或没有页面声明范围：不算过期", () => {
    expect(isOutdated(null, applied, [{}])).toBe(false);
    expect(isOutdated(applied, null, [{}])).toBe(false);
    expect(isOutdated(pulse("t2", { p1: "x" }), applied, [])).toBe(false);
  });

  it("关心全部的页面：总令牌一变就过期", () => {
    expect(isOutdated(pulse("t1", { p1: "a", p2: "b" }), applied, [{}])).toBe(false);
    expect(isOutdated(pulse("t2", { p1: "a", p2: "c" }), applied, [{}])).toBe(true);
  });

  it("项目页只看自己的项目：别的项目变化不触发重读", () => {
    const latest = pulse("t2", { p1: "a", p2: "c" });
    expect(isOutdated(latest, applied, [{ project: "p1" }])).toBe(false);
    expect(isOutdated(latest, applied, [{ project: "p2" }])).toBe(true);
  });

  it("项目从列表里消失（被移出）也算变化，服务端会给出不可访问页", () => {
    expect(isOutdated(pulse("t2", { p2: "b" }), applied, [{ project: "p1" }])).toBe(true);
  });

  it("多个范围里有一个过期就算过期", () => {
    const latest = pulse("t2", { p1: "a", p2: "c" });
    expect(isOutdated(latest, applied, [{ project: "p1" }, { project: "p2" }])).toBe(true);
  });
});
