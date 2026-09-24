import type { NextConfig } from "next";

/**
 * Orbit Next.js 配置（M0 基线）。
 * - reactStrictMode：开发期暴露副作用问题。
 * - poweredByHeader：关闭，避免泄露框架信息（见 docs/03 §8 可观测性/安全）。
 * - serverExternalPackages：pg 驱动含原生/动态 require，保持外部化，
 *   让 Prisma 7 driver adapter 在 Node 服务端运行时正常加载，不进客户端 bundle。
 * - allowedDevOrigins：允许本地回环主机访问 dev server。Playwright 等外部客户端访问
 *   `next dev` 时，若主机未在允许列表会触发「Blocked cross-origin request」，导致 HMR/资源
 *   加载失败、React 无法 hydrate（仅影响开发服务器，不影响生产构建）。
 */
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          // D5 修复：全站纵深防御头。X-Content-Type-Options 阻止 MIME 嗅探；
          // CSP 先只包含 frame-ancestors（等价 X-Frame-Options 的现代形式），
          // 不用宽泛 unsafe 指令也不影响 Next 内联脚本；完整脚本 CSP 需 nonce 中间件，
          // 按 Next 本地指南分阶段推进（docs/07 §6、审查 D5 勘误）。
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          // OI-27：应用不使用任何浏览器权限特性（相机/麦克风/定位等），
          // 全站默认拒绝；未来引入特性时按实际需求逐项放开。
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
  output: process.env.ORBIT_STANDALONE === "1" ? "standalone" : undefined,
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
