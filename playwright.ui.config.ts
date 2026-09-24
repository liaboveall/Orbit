import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base, testDir: "./tests/ui", reporter: "list",
  use: {...base.use, screenshot: "only-on-failure"},
  // B3 修复配套：样例路由（/app/samples/*、/app/ui-samples）在**生产构建**下由服务端
  // 门禁关闭（docs/02 §8「仅开发环境可见」）。UI 套件验证的设计系统页面以样例页为主，
  // 因此固定用 dev 模式运行（样例在开发环境应可用——这正是被验收的行为）。
  // 生产构建 + 独立测试服务的完整证据由 `pnpm test:e2e`（next start）继续提供。
  webServer: {...base.webServer as object,
    command: "pnpm exec prisma generate && node scripts/e2e-server.mjs",
    env: { ...((base.webServer as { env?: Record<string, string> }).env ?? {}), E2E_SERVER_MODE: "dev" },
  },
});
