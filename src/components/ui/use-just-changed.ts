"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 值刚刚发生变化的那一小段时间里返回 true，用来只在「变化的那一下」播放动画。
 * 首次渲染不算变化：一整页已完成的任务不会在加载时一起跳动。
 */
export function useJustChanged<T>(value: T, duration = 700): boolean {
  const previous = useRef(value);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setChanged(true);
    const timer = setTimeout(() => setChanged(false), duration);
    return () => clearTimeout(timer);
  }, [value, duration]);
  return changed;
}
