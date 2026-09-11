import { defineConfig, devices } from "@playwright/test";

// M0 UI 回归用例针对 development dev server（webServer）运行；/app/* 受 proxy.ts session cookie
// 门禁 + app/layout.tsx getSessionUser 双层保护，用例通过 tests/ui/auth-setup.ts 建立已验证会话并注入
// cookie（见 m0-review.spec.ts 的 beforeEach）。baseURL 主机需与 dev server 绑定主机一致。
const port = process.env.PORT ?? "3000";
// 统一使用 localhost，避免 127.0.0.1 vs localhost 导致的 Origin 校验失败
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

// 为 auth-setup.ts 提供一致的受信源配置，避免 POST 请求被 403 INVALID_ORIGIN 拒绝
process.env.E2E_PORT ??= String(port);
process.env.E2E_AUTH_ORIGIN ??= baseURL;

export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium-ui", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `pnpm exec prisma generate && pnpm exec next dev --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
