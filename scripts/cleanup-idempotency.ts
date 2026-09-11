#!/usr/bin/env tsx
import dotenv from "dotenv";
import pg from "pg";

/**
 * 幂等记录清理维护命令（docs/08 §6 维护类脚本）。
 *
 * 分批删除过期记录，走 IdempotencyRecord(expiresAt) 索引，离线运行不进请求路径。
 * 每批一个短事务（LIMIT 1000），删除完立即提交，不长时间持锁；循环直到无过期行。
 *
 * 用法：pnpm exec tsx scripts/cleanup-idempotency.ts [--dry-run]
 *   --dry-run：只统计过期记录数（SELECT count），不执行任何删除。
 * 显式加载约定环境文件（.env.local，回退 .env），连接 DATABASE_URL。
 * 环境闸门：仅允许 APP_ENV=development/test 运行（参考 prisma/seed.ts 的 SEED_ALLOWED_ENVS），
 * 拒绝在 staging/production 删数据，避免 DATABASE_URL 误指生产库时静默破坏。
 * 不回显连接串/凭证；失败以非零码退出。
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/** 允许执行清理的应用环境（AGENTS.md：不在生产库做破坏性维护）。 */
const CLEANUP_ALLOWED_ENVS = new Set(["development", "test"]);

/** 每批删除上限：短事务、限批量，避免长表锁与超大事务（docs/08 §6）。 */
const BATCH_SIZE = 1000;

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  // 环境闸门：仅在 development/test 执行，拒绝 staging/production（与 seed 一致）。
  const appEnv = process.env.APP_ENV ?? "development";
  if (!CLEANUP_ALLOWED_ENVS.has(appEnv)) {
    console.error(
      `[cleanup-idempotency] 拒绝在 APP_ENV=${appEnv} 下运行（仅允许 development/test）。`,
    );
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "[cleanup-idempotency] 缺少 DATABASE_URL。请复制 .env.example 为 .env.local 并填写。",
    );
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
  });

  // PostgreSQL 的 DELETE 不支持 LIMIT，用 id 子查询圈定本批（命中 expiresAt 索引）。
  const deleteBatch = `
    DELETE FROM "IdempotencyRecord"
    WHERE id IN (
      SELECT id FROM "IdempotencyRecord"
      WHERE "expiresAt" < NOW()
      LIMIT $1
    )
  `;

  let total = 0;
  try {
    await client.connect();
    if (dryRun) {
      // 只统计过期行数，不删除（命中 expiresAt 索引）。
      const counted = await client.query(
        'SELECT count(*)::int AS n FROM "IdempotencyRecord" WHERE "expiresAt" < NOW()',
      );
      const n = (counted.rows[0]?.n as number | undefined) ?? 0;
      console.log(`[cleanup-idempotency] --dry-run：当前过期幂等记录 ${n} 条（未删除）。`);
      return;
    }
    // 循环分批：每批独立短事务，删除完立即提交，直到 affected rows = 0。
    for (;;) {
      const result = await client.query(deleteBatch, [BATCH_SIZE]);
      const affected = result.rowCount ?? 0;
      if (affected === 0) break;
      total += affected;
      console.log(`[cleanup-idempotency] 本批删除 ${affected} 条，累计 ${total} 条。`);
      // 达到不足一批说明已清理完毕，提前结束减少一次空查询。
      if (affected < BATCH_SIZE) break;
    }
    console.log(`[cleanup-idempotency] 完成。共清理过期幂等记录 ${total} 条。`);
  } catch (error) {
    // 只打印错误消息，绝不回显连接串（含凭证）。
    console.error(
      "[cleanup-idempotency] 清理失败：",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

void main();
