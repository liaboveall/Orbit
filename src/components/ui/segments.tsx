"use client";

import { useCallback, useLayoutEffect, useRef, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * 流动的选中态：在容器里画一滴玻璃，跟着带 `data-active` 的后代移动。
 *
 * 只负责选中滴的位置和动画，横排的分段控件和竖排的侧栏都能用。选项本身
 * （Link、role=tab 的 button）由调用方渲染，语义和键盘行为不受影响。
 * 脚本就绪前由选中项自己画底色（见 glass.css）。
 */
export type SegmentsProps = ComponentProps<"div"> & {
  /** 当前选中项的标识；变化时选中滴移动。没有选中项时隐藏。 */
  activeKey: string | null | undefined;
};

export function Segments({ activeKey, className, children, ...props }: SegmentsProps) {
  const root = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const last = useRef<{ left: number; top: number } | null>(null);

  const place = useCallback(() => {
    const element = root.current;
    if (!element) return;
    const active = element.querySelector<HTMLElement>("[data-active]");
    if (!active) {
      delete element.dataset.placed;
      last.current = null;
      return;
    }
    const frame = element.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    const left = item.left - frame.left - element.clientLeft + element.scrollLeft;
    const top = item.top - frame.top - element.clientTop + element.scrollTop;
    element.style.setProperty("--segment-left", `${left}px`);
    element.style.setProperty("--segment-top", `${top}px`);
    element.style.setProperty("--segment-width", `${item.width}px`);
    element.style.setProperty("--segment-height", `${item.height}px`);
    element.style.setProperty("--segment-radius", getComputedStyle(active).borderTopLeftRadius);

    const previous = last.current;
    last.current = { left, top };
    element.dataset.placed = "";
    if (!previous || !("animate" in element.dataset)) return;
    const dx = Math.abs(left - previous.left);
    const dy = Math.abs(top - previous.top);
    if (dx < 2 && dy < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // 移动途中被拉长一点，到位后回弹，像一滴液体。
    thumb.current?.animate(
      [
        { transform: "none" },
        { transform: dx >= dy ? "scale(1.07, 0.9)" : "scale(0.96, 1.1)", offset: 0.4 },
        { transform: "none" },
      ],
      { duration: 380, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
    );
  }, []);

  // 每次渲染后重新定位：选项文字或数量变化时选中滴跟着走。
  useLayoutEffect(place);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    // 首次定位不做动画，下一帧再打开过渡。
    const frame = requestAnimationFrame(() => {
      element.dataset.animate = "";
    });
    const observer = new ResizeObserver(place);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [place]);

  return (
    <div ref={root} data-segments="" data-active-key={activeKey ?? undefined} className={cn(className)} {...props}>
      <span ref={thumb} data-segment-thumb="" aria-hidden="true" />
      {children}
    </div>
  );
}
