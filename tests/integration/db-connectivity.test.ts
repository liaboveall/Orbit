import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

// 运行时 env：仍经 parseEnv 完整安全校验（TEST_DATABASE_URL 指向开发/生产库名会被拒绝），
// 并作为下方真实连接的目标连接串来源。
const env = parseEnv(process.env as Record<string, string | undefined>);

/**
 * 从磁盘上的约定环境文件解析「原始配置值」，得到与运行时 process.env 隔离的局部快照。
 * 只读入局部对象，绝不写回 process.env（避免影响后续测试文件）。
 *
 * 为什么守卫要基于文件原始值而不是 process.env：
 * 全量串行运行 vitest 且 worker 进程被复用时，多个集成测试文件在**模块顶层**修改
 * process.env（APP_ENV="test" / BETTER_AUTH_SECRET / TRUSTED_PROXY_COUNT 等）且从不还原，
 * 这些改动会跨文件残留、污染 process.env。叠加 src/server/env.ts 的 A10 豁免分支
 * （APP_ENV="test" 且 DATABASE_URL 与 TEST_DATABASE_URL 逐字节相同时放行「测试库须独立」
 * 硬校验），被污染的 env 会让 parseEnv 返回 DATABASE_URL=orbit_test，使本守卫基于
 * process.env 的比较对象失真而误报。直接解析 .env.local/.env 的原始值不受此污染影响，
 * 稳定反映「配置层面两库必须不同」的真实意图。
 *
 * 加载优先级与上方 dotenv.config 一致：.env.local 优先、.env 回退；两者都缺失的键才回退到
 * process.env（兼容仅用真实环境变量、不落文件的 CI 场景）。
 */
function loadConfiguredDatabaseUrls(): { databaseUrl: string; testDatabaseUrl: string } {
  const parsed: Record<string, string> = {};
  // 先 .env 后 .env.local，Object.assign 让 .env.local 覆盖 .env → 与 dotenv.config 优先级一致。
  for (const file of [".env", ".env.local"]) {
    try {
      Object.assign(parsed, dotenv.parse(readFileSync(resolve(process.cwd(), file))));
    } catch {
      // 文件不存在（.env 为可选回退）时忽略。
    }
  }
  return {
    databaseUrl: parsed.DATABASE_URL ?? process.env.DATABASE_URL ?? "",
    testDatabaseUrl: parsed.TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? "",
  };
}

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
  it("TEST_DATABASE_URL 与 DATABASE_URL 指向不同的库（基于 .env.local 原始配置，免疫跨文件 process.env 污染）", () => {
    const { databaseUrl, testDatabaseUrl } = loadConfiguredDatabaseUrls();
    // 两个连接串都必须在约定环境文件中真实存在，否则守卫形同虚设。
    expect(databaseUrl).not.toBe("");
    expect(testDatabaseUrl).not.toBe("");
    // 核心安全意图：配置层面开发库与测试库必须是不同的库名，防止测试误连/污染开发库。
    expect(dbNameFromUrl(testDatabaseUrl)).not.toBe(dbNameFromUrl(databaseUrl));
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
