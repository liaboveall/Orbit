import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright 配置（e2e）。命令契约：pnpm test:e2e。
 *
 * - 默认自建服务：先 `pnpm build` 再 `pnpm start`（生产模式冒烟）。
 *   如已有服务在跑，设置 E2E_BASE_URL 复用，Playwright 将不再启动 webServer。
 * - 只绑定 localhost（docs/08 §1）。
 * - 首次运行需安装浏览器：pnpm exec playwright install --with-deps chromium
 *
 * 限流串行化（对齐 src/server/auth/options.ts：`/sign-up/email` 为 10 次 / 60s，内存存储）：
 *   E2E 全套注册十余名用户，故 `workers: 1` + `fullyParallel: false` 让全部用例在**单一
 *   Node 进程**内串行执行，配合 tests/ui/auth-setup.ts 的 `throttleSignUp` 全局排队，把注册
 *   速率压到限额之内（不关闭限流、不跳过用例、不弱化断言）。`timeout` 上调以容纳排队等待
 *   （单次最坏 ≈ 一个 60s 窗口），`retries: 1` 让偶发的窗口边界 429 有第二次机会。
 */
const port = process.env.PORT ?? "3000";
// 默认用 localhost（而非 127.0.0.1）：与应用 AUTH_TRUSTED_ORIGINS / BETTER_AUTH_URL
// (=http://localhost:3000) 同源，否则浏览器发起的写请求 Origin 会被服务端 Origin 白名单拒绝。
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm run build && pnpm run start",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
});
