import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["caption", "footnote", "label", "body", "title", "section", "page", "hero"] } } });

/**
 * 合并 className 的跨功能纯工具（docs/03 §3：lib/ 放确实跨功能的纯工具）。
 *
 * `clsx` 处理条件类，`tailwind-merge` 解决 Tailwind 工具类冲突（后者优先），
 * 让 UI 组件既能内建 token 样式，又能被调用方 `className` 安全覆盖。
 * 无服务端依赖，可在客户端与服务端组件共享。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
