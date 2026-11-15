"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * 会数数的数字：值变化时从当前显示的数字滚到新值（差得越多滚得稍久，上限 600ms）。
 * 首次显示不滚动；减少动态效果时直接换成新值。
 * 调用方给它加上 tabular-nums，数位变化时宽度不抖。
 */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const node = useRef<HTMLSpanElement>(null);
  /** 屏幕上此刻显示的数字（滚动中途是中间值）。 */
  const shown = useRef(value);

  useLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    const from = shown.current;
    // 没有可滚动的距离（包括滚到一半又被改回当前显示的数字）：DOM 上直接写成目标值。
    // 不能依赖 React 刚提交的文字——上一次滚动可能在它之后又改过。
    if (from === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shown.current = value;
      element.textContent = String(value);
      return;
    }
    // React 已经把文字换成了新值：先放回正在显示的数字，再一帧一帧滚过去。
    element.textContent = String(from);
    const duration = Math.min(600, 240 + Math.abs(value - from) * 30);
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const current = Math.round(from + (value - from) * eased);
      shown.current = current;
      element.textContent = String(current);
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    // 值又变了或组件卸载：只停下这一轮，下一轮从 shown 记录的数字接着滚。
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <span ref={node} className={className}>
      {value}
    </span>
  );
}
