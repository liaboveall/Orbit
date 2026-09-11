import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * /auth/* 认证路由布局（M1 / ORB-005）。
 *
 * 刻意与 /app/* 分离：/app/* 由 proxy.ts 的 session cookie 门禁 + app/layout.tsx 的
 * getSessionUser 权威会话校验双层保护（未登录/伪造/过期均重定向到登录页），而认证页
 * 在生产环境也必须对未登录用户可用，故不受该门禁影响（见 app/layout.tsx 的边界说明）。
 *
 * 这里只做元信息与被认证页共享的 robots 策略；视觉外壳（居中卡片 + Orbit 字标 + 背景）
 * 由各页通过 <AuthShell> 承载，因为每页标题/描述不同。
 */
export const metadata: Metadata = {
  title: { default: "Orbit · 登录", template: "%s · Orbit" },
  // 认证页不应被搜索引擎索引。
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
