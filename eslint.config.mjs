import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * ESLint 独立 CLI 配置（flat config）。
 * 命令契约 `pnpm lint` 使用 `eslint .`，不使用已废弃的 `next lint`。
 *
 * eslint-config-next 16 原生导出 flat config 预设（数组），直接展开即可，
 * 无需 @eslint/eslintrc 的 FlatCompat（那是给旧式 eslintrc 预设用的）。
 *  - core-web-vitals：Next.js App Router 关键 Web 规则（含 next 基础预设）。
 *  - nextTypescript：typescript-eslint recommended。
 *  - 额外将 no-explicit-any 提升为 error，落实 AGENTS.md「禁止用 any」。
 */
const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "src/generated/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "artifacts/**",
      ".qoder/**",
      "next-env.d.ts",
    ],
  },
  ...coreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // 客户端边界（AGENTS.md、docs/03 §3）：前端功能层/组件层禁止引用服务端专属模块。
    // 数据库、认证、存储 SDK 只允许服务端引用；含凭证/授权的模块用 server-only 保护，
    // 一旦进入 features/components 的 import 图即视为越界（会污染客户端 bundle）。
    files: ["src/features/**/*.{ts,tsx,js,jsx}", "src/components/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message: "服务端专属模块，禁止在 features/components（客户端层）导入。",
            },
            {
              name: "@prisma/client",
              message: "数据库 SDK 只允许服务端引用，禁止进入客户端层。",
            },
            {
              name: "pg",
              message: "数据库驱动只允许服务端引用，禁止进入客户端层。",
            },
          ],
          patterns: [
            {
              group: [
                "@/server",
                "@/server/*",
                "@/server/**",
                "@/generated",
                "@/generated/*",
                "@/generated/**",
              ],
              message:
                "服务端业务层/生成的 Prisma 客户端禁止在 features/components（客户端层）导入；数据经 /api 契约层传递。",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
