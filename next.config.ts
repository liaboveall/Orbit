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
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
