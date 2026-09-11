import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Orbit",
  description: "Orbit · 面向个人与学生小团队的项目协作 Web App（当前为 M0 工程基线）",
};

/**
 * 根布局（App Router）。
 * M0 仅提供最小外壳；AppShell、导航、设计 tokens 与主题属 ORB-002 范围。
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
