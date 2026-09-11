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

/**
 * UI 测试 Web Server 配置：强制 TEST_DATABASE_URL 指向 orbit_test，禁止复用开发库。
 * 启动后验证实际连接串，failure fail fast。
 */
const createWebServerConfig = () => {
  // 检查是否已有外部服务
  if (process.env.E2E_BASE_URL) {
    // 当 E2E_BASE_URL 被设置时，不再自建 webServer，由调用方保证隔离性
    return undefined;
  }

  // 强制 TEST_DATABASE_URL 指向独立测试库，不允许指向开发库
  const testDbUrl = process.env.TEST_DATABASE_URL ?? "postgresql://orbit:orbit_dev_only@localhost:5432/orbit_test";
  const devDbUrl = process.env.DATABASE_URL ?? "postgresql://orbit:orbit_dev_only@localhost:5432/orbit_dev";

  // 防止意外同名（同 M0 E2E 防护）
  const testDbName = new URL(testDbUrl).pathname.replace(/^\//, "");
  const devDbName = new URL(devDbUrl).pathname.replace(/^\//, "");
  if (testDbName === devDbName) {
    throw new Error(
      `UI 测试配置错误：TEST_DATABASE_URL 与 DATABASE_URL 指向同一数据库（${testDbName}），` +
        " 拒绝运行以避免误伤开发库。",
    );
  }

  return {
    command: `pnpm exec prisma generate && pnpm exec next dev --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      TEST_DATABASE_URL: testDbUrl,
      DATABASE_URL: devDbUrl, // 保持分离
      APP_ENV: "test",
    },
    // 自定义钩子：启动后验证实际连接的数据库名
    // 注：由于 Playwright webServer 不直接支持自定义 hook，我们通过在 spec 中的 beforeAll 实现验证
    // 详细验证逻辑见 tests/ui/support/db-isolation.ts
  };
};

export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium-ui", use: { ...devices["Desktop Chrome"] } }],
  webServer: createWebServerConfig(),
});
