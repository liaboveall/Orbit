"use client";

import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * 分段控件的容器：渲染一片会流动的玻璃胶囊，由带 `data-active` 的后代决定位置。
 *
 * 只负责选中胶囊的位置和动画，选项本身（Link、role=tab 的 button）由调用方渲染，
 * 语义和键盘行为不受影响。胶囊就绪前选项自己绘制选中底色（见 glass.css）。
 */
export type SegmentsProps = ComponentProps<"div"> & {
  /** 当前选中项的标识；变化时胶囊移动。没有选中项时胶囊隐藏。 */
  activeKey: string | null | undefined;
};

export function Segments({ activeKey, className, children, ...props }: SegmentsProps) {
  const root = useRef<HTMLDivElement>(null);
  const lastLeft = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const place = () => {
      const active = element.querySelector<HTMLElement>("[data-active]");
      if (!active) {
        delete element.dataset.placed;
        lastLeft.current = null;
        return;
      }
      const frame = element.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      const left = item.left - frame.left - element.clientLeft + element.scrollLeft;
      const right = element.clientWidth - left - item.width;
      const previous = lastLeft.current;
      // 朝哪边移动，哪边的边缘先到，另一边稍后跟上，形成液体被拉伸的感觉。
      element.style.setProperty("--segment-left-time", previous !== null && left > previous ? "420ms" : "260ms");
      element.style.setProperty("--segment-right-time", previous !== null && left > previous ? "260ms" : "420ms");
      element.style.setProperty("--segment-left", `${left}px`);
      element.style.setProperty("--segment-right", `${right}px`);
      lastLeft.current = left;
      element.dataset.placed = "";
    };
    place();
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
  }, [activeKey]);

  return (
    <div ref={root} data-segments="" className={cn(className)} {...props}>
      <span data-segment-thumb="" aria-hidden="true" />
      {children}
    </div>
  );
}
