"use client";

import { useEffect } from "react";

/**
 * 根布局错误边界（B2 修复）：捕获 root layout / template 的意外错误。
 * 按 Next 16.3 约定，global-error 激活时替换整个根布局，必须自带 <html>/<body>；
 * 仅展示中性中文文案，不泄露服务端细节。error 对象只在开发期打印。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error(error);
    }
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f7f8fa",
          color: "#171a21",
          fontFamily:
            "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: "24px 16px", maxWidth: 480 }}>
          <p role="alert" style={{ fontSize: 16, fontWeight: 600, margin: "0 0 8px" }}>
            应用出现意外错误
          </p>
          <p style={{ fontSize: 14, color: "#5b6472", margin: "0 0 20px" }}>
            请重新加载页面。这不会影响你已保存的数据。
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              display: "inline-block",
              border: "1px solid #e2e6ed",
              background: "#ffffff",
              color: "#171a21",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            重新加载
          </button>
        </div>
      </body>
    </html>
  );
}
