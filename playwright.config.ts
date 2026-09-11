import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright 配置（e2e）。命令契约：pnpm test:e2e。
 *
 * - 默认自建**测试专用**服务：`pnpm run build`（编译，DB 无关，见 scripts/e2e-server.mjs
 *   顶部注释）后由 `scripts/e2e-server.mjs` 启动 `next start`——该脚本校验
 *   TEST_DATABASE_URL 指向本机独立测试库且与 DATABASE_URL（开发库）不同名、已应用过迁移，
 *   再把 DATABASE_URL/BETTER_AUTH_URL/APP_URL/AUTH_TRUSTED_ORIGINS/PORT 作为**进程环境
 *   变量**注入子进程（优先级高于 next start 自动加载的 .env.local），确保测试服务器全程
 *   连接 orbit_test 而不是 orbit_dev（A10 修复，docs/08 §1）。
 * - 如已有**已核验的**测试服务在跑，设置 E2E_BASE_URL 复用，Playwright 将不再启动
 *   webServer——但复用前必须先对该地址跑一次 `scripts/verify-e2e-target.mjs`（见下）
 *   确认它连接的是测试库，不能凭地址形状臆断；本配置本身不做这层信任判断。
 * - 只绑定 localhost（docs/08 §1）。
 * - 首次运行需安装浏览器：pnpm exec playwright install --with-deps chromium
 *
 * 限流串行化（对齐 src/server/auth/options.ts：`/sign-up/email` 为 10 次 / 60s，内存存储）：
 *   E2E 全套注册十余名用户，故 `workers: 1` + `fullyParallel: false` 让全部用例在**单一
 *   Node 进程**内串行执行，配合 tests/ui/auth-setup.ts 的 `throttleSignUp` 全局排队，把注册
 *   速率压到限额之内（不关闭限流、不跳过用例、不弱化断言）。`timeout` 上调以容纳排队等待
 *   （单次最坏 ≈ 一个 60s 窗口），`retries: 1` 让偶发的窗口边界 429 有第二次机会。
 */
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
process.env.E2E_AUTH_ORIGIN ??= baseURL;

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
        command: "pnpm run build && node scripts/e2e-server.mjs",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 240_000,
      },
});
