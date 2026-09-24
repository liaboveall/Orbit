import "server-only";

/**
 * 数据库不可用错误识别（D2 修复，docs/03 §8、docs/05 §3）。
 *
 * 背景：driver adapter（@prisma/adapter-pg）下，池耗尽/连接超时不再携带 Prisma
 * 的 P2024/P1001 等 code，而是以 pg-pool 的裸 Error 到达 HTTP 错误映射层
 * （此前一律落 500，掩盖了「服务暂时不可用」的语义）。
 *
 * 本模块把「数据库暂时不可用」收敛为**有限已知错误形状**的白名单判断：
 *  - Prisma/driver 已知错误码：连接失败、池等待超时、连接数上限、PG 管理类错误；
 *  - pg-pool@3.14.0 源码中两种固定 message 的超时 Error（无 code）；
 *  - Node 网络系统错误码（cause 链深处出现）。
 *
 * 刻意**不**按「任意无 code Error」「任意 message 包含」或泛化的 P2028（事务回滚，
 * 通常是编程问题）扩大范围：未知形状仍按 500 上报，保持可观测。唯一例外是 P2028 中
 * 「maxWait 内无法开始事务」这一固定形状——它就是连接池饱和。
 */

/** 已知错误码集合：Prisma P 码 + Node 网络码 + PG 服务器码（errors.ts 原白名单 + P2037）。 */
const UNAVAILABLE_ERROR_CODES = new Set([
  "P1001", // Prisma: can't reach database server
  "P1002", // Prisma: database server reached timeout
  "P1008", // Prisma: operation timed out
  "P1017", // Prisma: server closed the connection
  "P2024", // Prisma: timed out fetching a new connection from the pool
  "P2037", // Prisma: too many database connections (PG 上限；驱动 adapter 下多为合成验证)
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "57P01", // admin_shutdown
  "53300", // too_many_connections
]);

/** pg-pool@3.14.0 池等待超时的固定 message（index.js:224，无 code）。 */
const PG_POOL_CHECKOUT_TIMEOUT_MESSAGE = "timeout exceeded when trying to connect";

/** pg-pool@3.14.0 建连超时包装 Error 的固定 message（index.js:276，cause 携带底层错误）。 */
const PG_POOL_CONNECT_TIMEOUT_MESSAGE = "Connection terminated due to connection timeout";

const PG_POOL_TIMEOUT_MESSAGES = new Set([
  PG_POOL_CHECKOUT_TIMEOUT_MESSAGE,
  PG_POOL_CONNECT_TIMEOUT_MESSAGE,
]);

/**
 * Prisma 7.10 交互式事务在 maxWait 内拿不到连接时抛出的 P2028 固定文案
 * （TransactionManagerError「Unable to start a transaction in the given time.」）。
 * 事务 maxWait（2s）短于 pg-pool 等待上限（5s），池饱和时写路径最先遇到的正是它；
 * 其余 P2028（事务已关闭/回滚等）仍按编程错误处理。
 */
const PRISMA_TRANSACTION_START_TIMEOUT = "Unable to start a transaction in the given time";

function isTransactionStartTimeout(code: unknown, message: unknown): boolean {
  return code === "P2028" && typeof message === "string" && message.includes(PRISMA_TRANSACTION_START_TIMEOUT);
}

/** cause 链最大深度：防御循环引用/异常长链，白名单判断不需要更深。 */
const MAX_CAUSE_DEPTH = 8;

function errorHasUnavailableShape(error: unknown, depth: number): boolean {
  if (error === null || typeof error !== "object" || depth > MAX_CAUSE_DEPTH) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && UNAVAILABLE_ERROR_CODES.has(code)) {
    return true;
  }

  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && PG_POOL_TIMEOUT_MESSAGES.has(message)) {
    return true;
  }
  if (isTransactionStartTimeout(code, message)) return true;

  const cause = (error as { cause?: unknown }).cause;
  return cause !== undefined && cause !== null && errorHasUnavailableShape(cause, depth + 1);
}

/**
 * 判断错误是否属于「数据库暂时不可用」（连接失败/池耗尽/PG 连接上限）。
 * 只匹配有限已知形状；调用方据此映射 503 SERVICE_UNAVAILABLE，其余仍 500。
 */
export function isDatabaseUnavailableError(error: unknown): boolean {
  return errorHasUnavailableShape(error, 0);
}
