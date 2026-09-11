import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Orbit",
  description: "有序 Orbit · 为个人与学生小团队提供项目、任务看板、讨论和私有附件协作。",
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
