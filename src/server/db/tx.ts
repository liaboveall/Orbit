import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { DomainError } from "@/server/http/errors";
import { prisma } from "./prisma";

/**
 * 事务与行锁基础设施（docs/04 §4）。
 *
 * 锁顺序约定（避免死锁）：**User → Project → Task → 子资源**。
 * 所有需要跨表持锁的写事务，必须按此顺序获取 FOR UPDATE 行锁；
 * 顺序一致可让并发事务形成全序，配合本文件的死锁/序列化重试兜底。
 *
 * 隔离级别统一 ReadCommitted（docs/04 §4）：写事务在锁保护下读己所写；
 * 看板一致快照等只读场景另行使用 REPEATABLE READ（不在本文件范围）。
 *
 * 超时：与连接池的 statement_timeout=10000/lock_timeout=5000（prisma.ts）呼应，
 * 事务默认 timeout=10000ms、maxWait=2000ms，超时即失败而非无限持锁。
 */

/** 事务可选项：超时与获取连接的最大等待。 */
export interface TransactionOptions {
  /** 事务执行上限（ms），默认 5000。 */
  timeout?: number;
  /** 从连接池获取连接的等待上限（ms），默认 2000。 */
  maxWait?: number;
}

/**
 * PostgreSQL 可重试的并发错误码：
 *  - 40P01 死锁检测、40001 序列化失败；
 *  - 55P03 lock_not_available（lock_timeout=3000 触发）——最常见的并发失败，同样值得退避重试。
 */
const RETRYABLE_PG_CODES = new Set(["40P01", "40001", "55P03"]);

/** 有限技术重试的退避序列（ms）：最多 3 次重试。 */
const RETRY_BACKOFF_MS = [50, 150, 450] as const;

/** lockProjectRow 返回的项目锁快照（仅并发控制所需字段）。 */
export interface LockedProjectRow {
  id: string;
  version: number;
  boardVersion: number;
  nextTaskNumber: number;
  archivedAt: Date | null;
  ownerId: string;
}

/** PostgreSQL SQLSTATE 形状：5 位大写字母或数字（用于滤除 Prisma 自身的 P2010 之类代码）。 */
const SQLSTATE_RE = /^[0-9A-Z]{5}$/;

/**
 * 收集错误链上的全部 PostgreSQL SQLSTATE（沿 cause 链向下，最多 6 层）。
 *
 * 背景：`@prisma/adapter-pg` 会把底层驱动错误的 code 改名为 originalCode 并包在
 * `{ kind: "TransactionWriteConflict" }` 里；上层 Prisma 又可能附加自己的 code（如 P2010）。
 * 因此不能「一遇到任意 .code 就返回」（那会被 P2010 短路，永远读不到下层 40P01），
 * 必须**全链扫描**、只接受 SQLSTATE 形状的值，且同时识别 `code` 与 `originalCode`。
 * 
 * Q06 修复：增加对 metadata.code 字段的识别，以覆盖 pg 驱动的新版错误结构。
 */
function collectPgCodes(error: unknown): string[] {
  const codes = new Set<string>();
  const seen = new Set<object>();
  function visit(value: unknown, depth: number): void {
    if (depth > 8 || !value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const item = value as Record<string, unknown>;
    for (const key of ["code", "originalCode", "sqlState"]) {
      const code = item[key];
      if (typeof code === "string" && SQLSTATE_RE.test(code)) codes.add(code);
    }
    for (const key of ["cause", "meta", "metadata", "driverAdapterError"]) visit(item[key], depth + 1);
  }
  visit(error, 0);
  return [...codes];
}

/** 是否为值得做技术重试的并发冲突错误（死锁 40P01 / 序列化失败 40001 / 锁超时 55P03）。 */
function isRetryableConcurrencyError(error: unknown): boolean {
  const codes = collectPgCodes(error);
  return codes.some((code) => RETRYABLE_PG_CODES.has(code));
}

/** 是否为锁超时（55P03 lock_not_available）——重试预算耗尽后映射为 409 而非 500。 */
function isLockTimeoutError(error: unknown): boolean {
  return collectPgCodes(error).includes("55P03");
}

/** 是否为业务版本冲突（VERSION_CONFLICT）——此类错误永不重试。 */
function isBusinessVersionConflict(error: unknown): boolean {
  // DomainError 会带有 code 字段，值为 VERSION_CONFLICT 表示业务冲突，不应重试
  const errObj = error as Record<string, unknown>;
  if (errObj.code === "VERSION_CONFLICT") {
    return true;
  }
  
  // 检查是否包含 VERSION_CONFLICT 元数据
  if (errObj.meta && typeof errObj.meta === "object") {
    const meta = errObj.meta as Record<string, unknown>;
    if (meta.isBusinessConflict === true) {
      return true;
    }
  }
  
  return false;
}

/** 睡眠指定毫秒（用于指数退避）。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 在 ReadCommitted 事务中执行 fn，并对死锁/序列化失败做**有限技术重试**
 * （最多 3 次，指数退避 50/150/450ms）。
 * 
 * Q06 修复：
 * - 区分业务版本冲突（VERSION_CONFLICT）与技术性锁超时（55P03）
 * - 业务冲突永不重试，直接返回 409
 * - 技术性锁超时先重试，预算耗尽后转为 409 LOCKED
 * - 增加对 metadata.code 字段的识别（新版 pg 驱动结构）
 *
 * fn 必须是幂等的纯数据库操作序列：重试会重新执行整个事务回调。
 */
export async function withTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: TransactionOptions = {},
): Promise<T> {
  const timeout = opts.timeout ?? 10000;
  const maxWait = opts.maxWait ?? 2000;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        timeout,
        maxWait,
        isolationLevel: "ReadCommitted",
      });
    } catch (error) {
      // Q06：业务版本冲突永不误试（semantic: VERSION_CONFLICT → 409）
      if (isBusinessVersionConflict(error)) {
        throw error;
      }
      
      // 仅对可重试并发错误且仍有重试预算时退避重试；否则按语义映射或透传。
      if (isRetryableConcurrencyError(error) && attempt < RETRY_BACKOFF_MS.length) {
        await sleep(RETRY_BACKOFF_MS[attempt] ?? 450);
        continue;
      }
      // 锁超时（55P03）预算耗尽：这是并发争用而非服务器故障，映射为语义正确的 409 LOCKED，
      // 让客户端「稍后重试」，而不是暴露成 500 INTERNAL_ERROR。每次 $transaction 都是新事务，
      // 故重试天然满足 aborted 后重开的要求。
      if (isLockTimeoutError(error)) {
        throw new DomainError("LOCKED", "当前资源正被其它操作占用，请稍后重试。");
      }
      throw error;
    }
  }
}

/**
 * 对项目行加 FOR UPDATE 排他锁，返回并发控制所需字段快照。
 * 项目不存在时返回 null（由调用方决定抛 NOT_FOUND，本函数不做业务判断）。
 *
 * 必须在 withTransaction 的 tx 内调用；锁在事务提交/回滚时释放。
 */
export async function lockProjectRow(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<LockedProjectRow | null> {
  const rows = await tx.$queryRaw<LockedProjectRow[]>`
    SELECT id, version, "boardVersion", "nextTaskNumber", "archivedAt", "ownerId"
    FROM "Project"
    WHERE id = ${projectId}::uuid
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

/**
 * 对用户行加 FOR UPDATE 排他锁（锁顺序最前：User → Project → …）。
 * 用于「创建项目」等无 Project 锁、需在用户级串行化配额与幂等记录的场景（docs/05 §5）。
 * 用户不存在时返回 null（由调用方决定后续处理）。
 */
export async function lockUserRow(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<{ id: string } | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE
  `;
  return rows[0] ?? null;
}
