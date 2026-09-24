import type { ReactNode } from "react";
import { notFound } from "next/navigation";

/**
 * 样例路由开发门禁（B3 修复，docs/02 §8「仅开发环境可见」）。
 *
 * 覆盖 /app/ui-samples 与 /app/samples/* 两个 fixture 样例段：NODE_ENV 是构建期
 * 常量，生产构建里该分支整体消除，样例路由直接 404；开发环境照常渲染。
 * 公开演示路由 /demo 不经 /app 会话外壳，不受影响。
 */
export default function SamplesDevGateLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV !== "development") notFound();
  return children;
}
