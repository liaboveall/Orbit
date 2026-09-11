import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest 5 配置。三个 project 对应命令契约：
 *   unit → pnpm test:unit，contract → pnpm test:contract，integration → pnpm test:integration。
 * e2e 走 Playwright（playwright.config.ts），不在 Vitest 内。
 */
const srcAlias = `${fileURLToPath(new URL("./src", import.meta.url)).replace(/\\/g, "/")}/`;
const serverOnlyStub = fileURLToPath(
  new URL("./tests/stubs/server-only.ts", import.meta.url),
).replace(/\\/g, "/");

export default defineConfig({
  resolve: {
    alias: [
      // 仅匹配 "@/" 前缀，避免误伤 "@prisma/*" 等 scoped 包。
      { find: /^@\//, replacement: srcAlias },
      // server-only 在纯 Node（Vitest）下会抛错，测试中替换为空桩；
      // 真实 Next 构建仍走正常 server-only 保护。
      { find: /^server-only$/, replacement: serverOnlyStub },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          // 为纯 Node 环境补齐浏览器 Web Storage（DraftManager/ORB-012 单测所需），
          // 仅在缺失时注入内存实现，不影响其他 unit 测试。
          setupFiles: [
            fileURLToPath(new URL("./tests/setup/unit-globals.ts", import.meta.url)).replace(
              /\\/g,
              "/",
            ),
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "contract",
          environment: "node",
          include: ["tests/contract/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          setupFiles: ["./tests/setup/integration-state.ts"],
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          fileParallelism: false,
          isolate: true,
        },
      },
    ],
  },
});
