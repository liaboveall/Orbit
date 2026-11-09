import dotenv from "dotenv";
import { defineConfig, env } from "prisma/config";
import { localDatabaseUrl } from "./src/lib/database-url";

/**
 * Prisma 7 不再自动加载 .env（见官方 to-v7 升级指南）。
 * 约定环境文件：本地开发使用 .env.local（与 Next.js 一致），.env 作为回退。
 * dotenv 默认不覆盖已存在的变量，因此先加载 .env.local 保证其优先级。
 * 这样 Prisma CLI（migrate/seed/db execute）与 Next 运行时读到同一份约定环境文件。
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // 类型安全的 env() 助手；不替代 dotenv，仅读取已加载的 process.env。
    url: localDatabaseUrl(env("DATABASE_URL")),
  },
});
