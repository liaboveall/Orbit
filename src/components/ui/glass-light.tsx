"use client";

import { useEffect } from "react";

const SURFACES = ".glass, .glass-card";

/**
 * 让玻璃表面的高光跟随指针。全站只注册一个监听器，每帧只写一个元素的两个变量。
 * 触屏设备和要求减少动态效果的用户不启用。
 */
export function GlassLight() {
  useEffect(() => {
    const capable = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!capable.matches || reduced.matches) return;

    let frame = 0;
    let event: PointerEvent | null = null;
    const paint = () => {
      frame = 0;
      if (!event || !(event.target instanceof Element)) return;
      const surface = event.target.closest<HTMLElement>(SURFACES);
      if (!surface) return;
      const box = surface.getBoundingClientRect();
      surface.style.setProperty("--glass-x", `${event.clientX - box.left}px`);
      surface.style.setProperty("--glass-y", `${event.clientY - box.top}px`);
    };
    const move = (next: PointerEvent) => {
      event = next;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
