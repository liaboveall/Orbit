import dotenv from "dotenv";
import { spawn } from "node:child_process";
import net from "node:net";
import pg from "pg";

/**
 * scripts/e2e-server.mjs —— E2E 专用应用服务启动器（A10 修复，docs/08 §1：
 * 「测试使用独立数据库orbit_test和独立对象前缀，不复用orbit_dev的数据」）。
 *
 * 背景：`playwright.config.ts` 此前直接 `pnpm run build && pnpm run start`，Next.js
 * 生产模式会加载 `.env.local` 的 `DATABASE_URL`（指向 orbit_dev）；E2E 测试因此一直
 * 直连开发库，长期累积测试数据噪音（历史审查已记录 orbit_dev 170 用户/10 项目的残留）。
 *
 * 修复方式：不新增数据库实例或基础设施，复用同一个本地 PostgreSQL 服务，但显式把
 * `DATABASE_URL`/`BETTER_AUTH_URL`/`APP_URL`/`AUTH_TRUSTED_ORIGINS`/`PORT` 作为
 * **进程环境变量**传给 `next start` 子进程——按 Next.js 官方文档的环境变量加载顺序
 * （process.env > .env.$(NODE_ENV).local > .env.local > .env.$(NODE_ENV) > .env），
 * 已存在于 process.env 的变量优先级最高，不会被 `.env.local` 覆盖，因此测试服务器
 * 全程连接 orbit_test，从不触碰 orbit_dev。
 *
 * 运行前校验（拒绝而非静默复用）：
 *  1. TEST_DATABASE_URL 必须指向本机、且数据库名不得与 DATABASE_URL（开发库）相同；
 *  2. 实际尝试连接该库，确认可达且 `_prisma_migrations` 表存在迁移记录（防止指向
 *     一个从未迁移的空库或误配置的库）；
 *  3. 目标应用端口（默认 3100，与开发服务器默认的 3000 分开，防止静默复用正在运行的
 *     开发服务器）必须空闲，否则视为「无法确认独立服务」并拒绝启动。
 *
 * 用法：node scripts/e2e-server.mjs
 * 成功后在 stdout 打印 `E2E_SERVER_READY <baseURL>`，供 playwright.config.ts 的
 * webServer.url 复用同一地址等待就绪。
 */

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
const E2E_HOST = "localhost";

/** 校验一个 postgres 连接串是否指向本机（拒绝任何非 localhost/127.0.0.1 的目标）。 */
function assertLocalPostgres(rawUrl, label) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error(`${label} 不是合法的连接串。`);
  }
  if (!["localhost", "127.0.0.1"].includes(target.hostname)) {
    throw new Error(`${label} 必须指向本机（localhost/127.0.0.1），拒绝连接远程主机。`);
  }
  const dbName = target.pathname.replace(/^\//, "");
  if (!dbName) {
    throw new Error(`${label} 缺少数据库名。`);
  }
  return { url: target, dbName };
}

/** 端口是否已被占用（用于拒绝"静默复用正在运行的服务"）。 */
function isPortFree(port, host) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => tester.close(() => resolve(true)));
    tester.listen(port, host);
  });
}

async function main() {
  const devUrl = process.env.DATABASE_URL;
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    console.error("[e2e-server] 缺少 TEST_DATABASE_URL，拒绝启动（不会静默回退到开发库）。");
    process.exit(1);
  }
  if (!devUrl) {
    console.error("[e2e-server] 缺少 DATABASE_URL，无法核对测试库与开发库是否同名。");
    process.exit(1);
  }

  let devTarget;
  let testTarget;
  try {
    devTarget = assertLocalPostgres(devUrl, "DATABASE_URL");
    testTarget = assertLocalPostgres(testUrl, "TEST_DATABASE_URL");
  } catch (error) {
    console.error(`[e2e-server] ${error.message}`);
    process.exit(1);
  }

  if (testTarget.dbName === devTarget.dbName) {
    console.error(
      `[e2e-server] TEST_DATABASE_URL 与 DATABASE_URL 指向同一个数据库（${testTarget.dbName}）。` +
        " E2E 必须使用独立测试库，拒绝启动以避免误连开发/生产库。",
    );
    process.exit(1);
  }

  // 实际连接测试库，确认可达且已应用过迁移（_prisma_migrations 至少一行）。
  const client = new pg.Client({
    connectionString: testTarget.url.href,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const dbCheck = await client.query("SELECT current_database() AS db");
    if (dbCheck.rows[0]?.db !== testTarget.dbName) {
      throw new Error(
        `连接后实际数据库名（${dbCheck.rows[0]?.db}）与连接串声明的（${testTarget.dbName}）不一致。`,
      );
    }
    const migrations = await client.query(
      `SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    const count = migrations.rows[0]?.count ?? 0;
    if (count === 0) {
      throw new Error(
        "测试库尚无已完成的迁移记录，请先执行 `pnpm exec dotenv -e .env.local -- prisma migrate deploy`" +
          "（DATABASE_URL 临时指向 TEST_DATABASE_URL）或专用迁移命令后再运行 E2E。",
      );
    }
    console.log(`[e2e-server] 测试库校验通过：${testTarget.dbName}，${count} 条已完成迁移。`);
  } catch (error) {
    console.error(
      `[e2e-server] 测试库校验失败：${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  } finally {
    await client.end().catch(() => undefined);
  }

  const portFree = await isPortFree(E2E_PORT, E2E_HOST);
  if (!portFree) {
    console.error(
      `[e2e-server] 端口 ${E2E_PORT} 已被占用，拒绝启动——` +
        "无法确认这不是复用了另一个未知服务（可能是残留的开发服务器）。" +
        ` 请释放端口 ${E2E_PORT} 或设置 E2E_PORT 指向其它空闲端口。`,
    );
    process.exit(1);
  }

  const baseURL = `http://${E2E_HOST}:${E2E_PORT}`;

  // 关键：这些变量作为**子进程环境变量**传入，优先级高于 next start 自动加载的
  // .env.local，因此测试服务器全程连接 orbit_test 而不是开发库。
  const childEnv = {
    ...process.env,
    DATABASE_URL: testTarget.url.href,
    APP_URL: baseURL,
    BETTER_AUTH_URL: baseURL,
    AUTH_TRUSTED_ORIGINS: baseURL,
    PORT: String(E2E_PORT),
    APP_ENV: "test",
  };

  console.log(`[e2e-server] 启动测试专用服务：${baseURL}（DATABASE_URL -> ${testTarget.dbName}）`);
  console.log(`E2E_SERVER_READY ${baseURL}`);

  const child = spawn("pnpm", ["exec", "next", "start", "-p", String(E2E_PORT)], {
    env: childEnv,
    stdio: "inherit",
    shell: true,
  });

  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

void main();
