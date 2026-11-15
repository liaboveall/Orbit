import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onWake } from "@/lib/wake";

/**
 * 回到标签页的监听（lib/wake.ts）：浏览器接连触发的 visibilitychange + focus 只算一次，
 * 同一类型的事件每次都算。浏览器回归里连续派发两次 focus 必须各触发一次重读。
 */

const scope = globalThis as unknown as { window?: EventTarget; document?: EventTarget & { visibilityState: string } };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T08:00:00Z"));
  scope.window = new EventTarget();
  scope.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
});

afterEach(() => {
  vi.useRealTimers();
  delete scope.window;
  delete scope.document;
});

const focus = () => scope.window!.dispatchEvent(new Event("focus"));
const visibility = () => scope.document!.dispatchEvent(new Event("visibilitychange"));

describe("onWake", () => {
  it("切回标签页的一对事件只触发一次", () => {
    const listener = vi.fn();
    onWake(listener);
    visibility();
    vi.advanceTimersByTime(5);
    focus();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("顺序相反的一对同样只触发一次", () => {
    const listener = vi.fn();
    onWake(listener);
    focus();
    visibility();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("连续两次 focus 各触发一次，不管隔多近", () => {
    const listener = vi.fn();
    onWake(listener);
    focus();
    vi.advanceTimersByTime(10);
    focus();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("隔得够久的两种事件各算一次", () => {
    const listener = vi.fn();
    onWake(listener);
    visibility();
    vi.advanceTimersByTime(150);
    focus();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("标签页不可见时不触发", () => {
    const listener = vi.fn();
    onWake(listener);
    scope.document!.visibilityState = "hidden";
    visibility();
    focus();
    expect(listener).not.toHaveBeenCalled();
  });

  it("取消后不再触发", () => {
    const listener = vi.fn();
    const stop = onWake(listener);
    stop();
    focus();
    visibility();
    expect(listener).not.toHaveBeenCalled();
  });
});
