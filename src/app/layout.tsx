import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { LiquidGlass } from "@/components/ui/liquid-glass";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Orbit",
  description: "有序 Orbit · 为个人与学生小团队提供项目、任务看板、讨论和私有附件协作。",
};

export const viewport: Viewport = {
  // iOS 上让玻璃标签栏延伸到安全区，并让浏览器工具栏跟随主题色。
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f3f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0f" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <LiquidGlass />
        {children}
      </body>
    </html>
  );
}
