import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/server/env";

/**
 * Prisma 7 单例（docs/03 §3：src/server/db = Prisma singleton、事务帮助函数）。
 *
 * Prisma 7 强制使用 driver adapter：`new PrismaClient({ adapter })`，
 * 这里用 PostgreSQL 适配器 @prisma/adapter-pg（PrismaPg）。
 * server-only 保护：本模块含数据库凭证，禁止进入客户端 bundle。
 *
 * 长驻 Node 服务应保持单一实例，避免多连接池打满数据库连接上限（见官方文档）。
 * 开发环境用 globalThis 缓存，规避 HMR 重复创建实例。
 */
function createPrismaClient(): PrismaClient {
  const { DATABASE_URL, DATABASE_POOL_MAX } = getEnv();
  // 连接池与超时参数（docs/04 §4：事务超时目标——写事务应在秒级完成或快速失败，
  // 避免长事务持锁拖垮并发）。各参数用途：
  //   max: 池内最大连接数，限制单实例对数据库的连接占用（配合多实例部署留出余量）。
  //   idleTimeoutMillis: 空闲连接回收时间，避免长期占用数据库连接槽。
  //   connectionTimeoutMillis: 从池获取连接的等待上限，池打满时快速失败而非无限排队。
  //   options: 会话级 PostgreSQL 运行时参数——
  //     statement_timeout=10000: 单条语句最长 10s，兜底防止慢查询长期占用连接。
  //     lock_timeout=5000: 等锁最长 5s，超时即失败（配合 tx.ts 的死锁/序列化重试）。
  const adapter = new PrismaPg({
    connectionString: DATABASE_URL,
    max: DATABASE_POOL_MAX,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    options: "-c statement_timeout=10000 -c lock_timeout=5000 -c timezone=UTC",
  });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  orbitPrismaClient?: PrismaClient;
};

export const prisma: PrismaClient = globalForPrisma.orbitPrismaClient ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.orbitPrismaClient = prisma;
}
