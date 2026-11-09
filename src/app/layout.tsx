import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { GlassLight } from "@/components/ui/glass-light";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Orbit",
  description: "有序 Orbit · 为个人与学生小团队提供项目、任务看板、讨论和私有附件协作。",
};

export const viewport: Viewport = {
  // iOS 上让玻璃标签栏延伸到安全区，并让浏览器工具栏跟随主题色。
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c10" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <GlassLight />
        {children}
      </body>
    </html>
  );
}
