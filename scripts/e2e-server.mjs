import dotenv from "dotenv";
import { spawn } from "node:child_process";
import net from "node:net";
import pg from "pg";
import { killProcessTree } from "./process-tree.mjs";

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
 * 全程连接 orbit_test，从不触碰 orbit_dev。子进程把 DATABASE_URL 覆写为
 * TEST_DATABASE_URL 的值后，两者在子进程里逐字节相同——src/server/env.ts 对
 * APP_ENV=test 且两值相同的这一精确形状放行「测试库同名」检查（仍保留开发/生产库
 * 名模式黑名单，且默认严格拒绝任何其它「DATABASE_URL 与 TEST_DATABASE_URL 撞库」场景）。
 *
 * 运行前校验（拒绝而非静默复用）：
 *  1. TEST_DATABASE_URL 必须指向本机、且数据库名不得与 DATABASE_URL（开发库）相同；
 *  2. 实际尝试连接该库，确认可达且 `_prisma_migrations` 表存在迁移记录（防止指向
 *     一个从未迁移的空库或误配置的库）；
 *  3. 目标应用端口（默认 3100，与开发服务器默认的 3000 分开，防止静默复用正在运行的
 *     开发服务器）必须空闲，否则视为「无法确认独立服务」并拒绝启动。
 *
 * 启动后校验（不是只看 stdout 的 "Ready" 字样——那只代表 Next.js 的 HTTP 监听已打开，
 * 不代表应用运行时通过了自己的环境校验；env.ts 的 EnvValidationError 会在请求处理期
 * 抛出 500，监听端口本身仍然存在）：
 *  4. 轮询 GET {baseURL}/api/v1/me，要求在 STARTUP_TIMEOUT_MS 内收到 401（未认证，
 *     这是该端点在无 cookie 时的唯一预期响应）；收到 500 视为「进程活着但应用没跑起来」，
 *     继续轮询到超时后仍失败则报错退出；超时或任何非 401/200 系列的持续响应都判定失败。
 *  5. 启动失败或超时：只终止**本次调用自己 spawn 的那棵进程树**（按 PID 精确定位），
 *     不按「端口 3100 当前被谁占用」清理——那个端口号可能被系统上完全无关的进程/服务
 *     占用（例如 TCP 连接表里滞留的记录），按端口硬杀会误杀无关进程，这里不这么做。
 *
 * 用法：node scripts/e2e-server.mjs
 * 成功后在 stdout 打印 `E2E_SERVER_READY <baseURL>`——此时已经过真实 HTTP 健康检查，
 * 不是进程刚 spawn 时的乐观假设；供 playwright.config.ts 的 webServer.url 复用同一地址。
 */

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
const E2E_HOST = "localhost";
const STARTUP_TIMEOUT_MS = Number(process.env.E2E_SERVER_STARTUP_TIMEOUT_MS ?? 60_000);
const POLL_INTERVAL_MS = 500;
// 端口缓冲重试：如果端口被残留进程占用，给它最多 10s 的缓冲时间尝试释放
const PORT_RETRY_DELAY_MS = 5000;

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
    tester.once("error", (error) => {
      console.error(`[e2e-server] 无法绑定 ${host}:${port}（${error.code ?? "UNKNOWN"}）；EACCES 表示系统拒绝访问，EADDRINUSE 表示已有监听。`);
      resolve(false);
    });
    tester.once("listening", () => tester.close(() => resolve(true)));
    tester.listen(port, host);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 终止一个由 shell:true 启动的子进程及其子孙（Windows 下 spawn 出的是 cmd.exe，
 * 直接 kill 父进程不会带走它启动的 next 二进制；改用 taskkill /T 递归终止整个树，
 * 非 Windows 平台上给整个进程组发信号）。
 */

/**
 * 轮询健康检查端点直到收到 401（未认证，该端点在无 cookie 时的唯一预期响应）或超时。
 * 子进程提前退出也视为失败（不再等到超时）。
 */
async function waitForHealthy(baseURL, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = "尚未发出过请求";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`子进程已退出（code=${child.exitCode}），启动失败。`);
    }
    try {
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 5_000);
      let response;
      try {
        response = await fetch(`${baseURL}/api/v1/me`, {
          method: "GET",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(abortTimer);
      }
      if (response.status === 401) {
        return; // 健康：应用已跑起来且按预期拒绝未认证请求。
      }
      lastFailure = `收到 HTTP ${response.status}（预期 401）——进程可能已监听端口，但应用未正常处理请求（例如环境变量校验失败）。`;
    } catch (error) {
      lastFailure = `连接失败：${error instanceof Error ? error.message : error}`;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`等待应用就绪超时（${timeoutMs}ms）。最后一次失败原因：${lastFailure}`);
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
        "测试库尚无已完成的迁移记录，请先对 TEST_DATABASE_URL 执行迁移" +
          "（例如：$env:DATABASE_URL=$env:TEST_DATABASE_URL; pnpm exec prisma migrate deploy）后再运行 E2E。",
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
      `[e2e-server] 端口 ${E2E_PORT} 已被占用，等待 ${PORT_RETRY_DELAY_MS}ms 再次尝试释放...`,
    );
    await sleep(PORT_RETRY_DELAY_MS);
    const portFreeRetry = await isPortFree(E2E_PORT, E2E_HOST);
    if (!portFreeRetry) {
      console.error(
        `[e2e-server] 端口 ${E2E_PORT} 仍被占用，拒绝启动——` +
          "无法确认这不是复用了另一个未知服务（可能是残留的开发服务器）。" +
          ` 请释放端口 ${E2E_PORT} 或设置 E2E_PORT 指向其它空闲端口。`,
      );
      process.exit(1);
    }
    console.log(`[e2e-server] 端口 ${E2E_PORT} 现已可用。`);
  }

  const baseURL = `http://${E2E_HOST}:${E2E_PORT}`;

  // 关键：这些变量作为**子进程环境变量**传入，优先级高于 next start 自动加载的
  // .env.local，因此测试服务器全程连接 orbit_test 而不是开发库。DATABASE_URL 显式
  // 设为与 TEST_DATABASE_URL 完全相同的字符串——这正是 src/server/env.ts 放行
  // 「测试库同名检查」所要求的精确条件（APP_ENV=test + 两值逐字节相同）。
  const childEnv = {
    ...process.env,
    DATABASE_URL: testTarget.url.href,
    TEST_DATABASE_URL: testTarget.url.href,
    APP_URL: baseURL,
    BETTER_AUTH_URL: baseURL,
    AUTH_TRUSTED_ORIGINS: baseURL,
    PORT: String(E2E_PORT),
    APP_ENV: "test",
    // Loaded only by this verified test runner; production has no fault hook.
    NODE_OPTIONS: process.env.ORBIT_TEST_FAULT_FILE
      ? `${process.env.NODE_OPTIONS ?? ""} --import ${JSON.stringify(new URL("../tests/e2e/support/render-fault.mjs", import.meta.url).href)}`
      : process.env.NODE_OPTIONS,
  };

  console.log(`[e2e-server] 启动测试专用服务：${baseURL}（DATABASE_URL -> ${testTarget.dbName}）`);

  const child = spawn("pnpm", ["exec", "next", process.env.E2E_SERVER_MODE === "dev" ? "dev" : "start", "--hostname", "localhost", "-p", String(E2E_PORT)], {
    env: childEnv,
    stdio: "inherit",
    shell: true,
    windowsHide: true,
    // F41：POSIX 下让子进程成为独立进程组（-child.pid 组 kill 才有效）；
    // Windows 由 taskkill /T 按进程树清理，不需要也不应使用 detached（会改变控制台行为）。
    detached: process.platform !== "win32",
  });

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    killProcessTree(child);
  };

  const forwardSignal = (signal) => {
    cleanup();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));
  process.on("exit", cleanup);

  try {
    await waitForHealthy(baseURL, child, STARTUP_TIMEOUT_MS);
  } catch (error) {
    console.error(
      `[e2e-server] 启动失败或超时：${error instanceof Error ? error.message : error}`,
    );
    cleanup();
    process.exit(1);
  }

  console.log(`[e2e-server] 健康检查通过（GET /api/v1/me -> 401）。`);
  console.log(`E2E_SERVER_READY ${baseURL}`);

  child.on("exit", (code) => {
    cleanedUp = true; // 子进程已自行退出，不需要再 kill 它。
    process.exit(code ?? 0);
  });
}

void main();
