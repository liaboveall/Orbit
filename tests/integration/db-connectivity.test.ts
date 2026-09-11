import { afterAll, beforeAll, describe, expect, it } from "vitest";
import dotenv from "dotenv";
import pg from "pg";
import { parseEnv } from "@/server/env";

/**
 * 集成测试（M0 最小真实断言）：验证「独立测试库可连接」。
 *
 * - 显式加载约定环境文件（.env.local，回退 .env），与 Prisma CLI / Next 一致。
 * - 连接前经 parseEnv 校验：TEST_DATABASE_URL 指向开发/生产库名会被直接拒绝（docs/08 §7）。
 * - 运行前需 `docker compose -f infra/compose.dev.yml up -d` 起库并创建 orbit_test。
 * - 这不是 exit 0 空脚本：它真实连库并断言查询结果与库名。
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);

function dbNameFromUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  return url.pathname.replace(/^\//, "");
}

const client = new pg.Client({ connectionString: env.TEST_DATABASE_URL });

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

describe("独立测试库连接", () => {
  it("TEST_DATABASE_URL 与 DATABASE_URL 指向不同的库", () => {
    expect(dbNameFromUrl(env.TEST_DATABASE_URL)).not.toBe(dbNameFromUrl(env.DATABASE_URL));
  });

  it("能连接并对 SELECT 1 返回 1", async () => {
    const result = await client.query("SELECT 1 AS ok");
    expect(Number(result.rows[0]?.ok)).toBe(1);
  });

  it("当前连接的数据库确实是约定的测试库", async () => {
    const result = await client.query("SELECT current_database() AS db");
    expect(result.rows[0]?.db).toBe(dbNameFromUrl(env.TEST_DATABASE_URL));
  });
});
