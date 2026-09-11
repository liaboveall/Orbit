import dotenv from "dotenv";
import pg from "pg";

/**
 * scripts/check-db.ts —— 显式验证「数据库可连接」（M0 验收项：空数据库可连接）。
 *
 * 用法：pnpm exec tsx scripts/check-db.ts
 * 显式加载约定环境文件（.env.local，回退 .env），连接 DATABASE_URL 并做只读探测。
 * 不写任何数据；连接失败以非零码退出并打印脱敏错误（不回显连接串）。
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[check-db] 缺少 DATABASE_URL。请复制 .env.example 为 .env.local 并填写。");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const result = await client.query(
      "SELECT current_database() AS db, current_user AS usr, version() AS version",
    );
    const row = result.rows[0];
    console.log("[check-db] 连接成功。");
    console.log(`[check-db] database = ${row?.db ?? "(unknown)"}`);
    console.log(`[check-db] user     = ${row?.usr ?? "(unknown)"}`);
    console.log(`[check-db] server   = ${String(row?.version ?? "").split(",")[0]}`);
  } catch (error) {
    // 只打印错误消息，绝不回显连接串（含凭证）。
    console.error("[check-db] 连接失败：", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

void main();
