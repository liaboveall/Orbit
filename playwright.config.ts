import { defineConfig, devices } from "@playwright/test";

import dotenv from "dotenv";
dotenv.config({path:[".env.local", ".env"],quiet:true});
if (process.env.E2E_BASE_URL) throw new Error("External E2E_BASE_URL reuse is disabled; use the isolated runner.");
const E2E_PORT = process.env.E2E_PORT ?? "3100";
// 默认用 localhost（而非 127.0.0.1）：与应用 AUTH_TRUSTED_ORIGINS / BETTER_AUTH_URL 同源，
// 否则浏览器发起的写请求 Origin 会被服务端 Origin 白名单拒绝。默认端口 3100 与开发服务器
// 默认的 3000 分开，防止 Playwright 静默复用一个正在运行的开发服务器（那台服务器可能
// 连接 orbit_dev）。
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${E2E_PORT}`;

// 这个配置文件本身运行在 Playwright 的 Node 进程里，此处赋值会在同一进程内持续可见——
// 测试文件（tests/e2e/*.spec.ts、tests/ui/auth-setup.ts）据此得到与 webServer 一致的
// E2E_PORT/E2E_AUTH_ORIGIN，不需要在每个 spec 文件里各自猜测端口号。
process.env.E2E_PORT = E2E_PORT;
process.env.E2E_AUTH_ORIGIN = baseURL;

export default defineConfig({
  globalSetup: "./tests/e2e/support/isolation-setup.ts",
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
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
        command: "pnpm run build && node scripts/e2e-server.mjs",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 240_000,
      },
});
