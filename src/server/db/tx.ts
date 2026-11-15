import "server-only";
import { Prisma, type Project } from "@/generated/prisma/client";
import { DomainError } from "@/server/http/errors";
import { prisma } from "./prisma";
import { toProjectRow, type RawProjectRow } from "./project-row";

/**
 * 事务与行锁基础设施（docs/04 §4）。
 *
 * 锁顺序约定（避免死锁）：**User → Project → Task → 子资源**。
 * 所有需要跨表持锁的写事务，必须按此顺序获取行锁；
 * 顺序一致可让并发事务形成全序，配合本文件的死锁/序列化重试兜底。
 *
 * 行锁用 FOR NO KEY UPDATE：它与自身互斥，写事务仍按项目（或用户）串行；但不与外键检查
 * 取得的 FOR KEY SHARE 冲突。ActivityLog.actorId、Task.assigneeId 等外键写入会对被引用的
 * User / Project 行取 KEY SHARE，若串行锁用 FOR UPDATE，这些写入会排在归档/恢复持有的用户锁
 * 之后，并可能与之形成「用户锁等项目锁、项目锁等用户行」的死锁。
 *
 * 隔离级别用 PostgreSQL 默认的 READ COMMITTED，不再显式发送 SET TRANSACTION（每个写事务省
 * 一次往返）：写事务在锁保护下读己所写，持锁后的每条语句都取新快照。
 *
 * 超时：与连接池的 statement_timeout=10000/lock_timeout=5000（prisma.ts）呼应，
 * 事务默认 timeout=10000ms、maxWait=2000ms，超时即失败而非无限持锁。
 */

/** 事务可选项：超时与获取连接的最大等待。 */
export interface TransactionOptions {
  /** 事务执行上限（ms），默认 10000（与 statement_timeout 一致，见下方模块注释）。 */
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
 * 在 READ COMMITTED（库默认）事务中执行 fn，并对死锁/序列化失败做**有限技术重试**
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
      return await prisma.$transaction(fn, { timeout, maxWait });
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
 * 对项目行加 FOR NO KEY UPDATE 行锁，返回**持锁后的完整项目行**。
 * 项目不存在时返回 null（由调用方决定抛 NOT_FOUND，本函数不做业务判断）。
 *
 * 等锁期间别的事务提交了对该行的修改时，PostgreSQL 会按最新行版本重新取值，所以返回值
 * 就是权威状态，调用方不需要再读一次 Project。成员关系存在别的表里，必须在拿到锁之后用
 * **单独一条语句**判定（见 authorization/project-access.ts 的 accessForLockedProject）：
 * 同一条语句里的子查询沿用等锁之前的快照，会看不到刚提交的成员移除。
 *
 * 必须在 withTransaction 的 tx 内调用；锁在事务提交/回滚时释放。
 */
export async function lockProjectRow(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<Project | null> {
  const rows = await tx.$queryRaw<RawProjectRow[]>`
    SELECT p.* FROM "Project" p
    WHERE p.id = ${projectId}::uuid
    FOR NO KEY UPDATE OF p
  `;
  const row = rows[0];
  return row ? toProjectRow(row) : null;
}

/**
 * 按任务定位并锁定其所属项目（一条语句，取代「先读 Task.projectId 再锁 Project」两次往返）。
 * 任务不存在时返回 null。任务不会跨项目移动，所以子查询读到的 projectId 不会过期；
 * 任务本身的状态（软删除、版本）仍须在持锁后重新读取。
 */
export async function lockProjectOfTask(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<Project | null> {
  const rows = await tx.$queryRaw<RawProjectRow[]>`
    SELECT p.* FROM "Project" p
    WHERE p.id = (SELECT t."projectId" FROM "Task" t WHERE t.id = ${taskId}::uuid)
    FOR NO KEY UPDATE OF p
  `;
  const row = rows[0];
  return row ? toProjectRow(row) : null;
}

/** 可以反查所属项目的任务子资源表（固定白名单，不接受外部输入）。 */
const TASK_CHILD_TABLE = {
  subtask: Prisma.raw('"Subtask"'),
  comment: Prisma.raw('"Comment"'),
  attachment: Prisma.raw('"Attachment"'),
} as const;

/**
 * 按子任务 / 评论 / 附件定位并锁定其所属项目，同时带回父任务 id（一条语句）。
 * 子资源不存在时返回 null。子资源不会换父任务、任务不会换项目，所以连接读到的归属
 * 不会过期；子资源自身的状态（软删除、版本）仍须在持锁后重新读取。
 */
export async function lockProjectOfTaskChild(
  tx: Prisma.TransactionClient,
  child: keyof typeof TASK_CHILD_TABLE,
  childId: string,
): Promise<{ project: Project; taskId: string } | null> {
  const rows = await tx.$queryRaw<Array<RawProjectRow & { childTaskId: string }>>`
    SELECT p.*, c."taskId" AS "childTaskId"
    FROM "Project" p
    JOIN "Task" t ON t."projectId" = p.id
    JOIN ${TASK_CHILD_TABLE[child]} c ON c."taskId" = t.id
    WHERE c.id = ${childId}::uuid
    FOR NO KEY UPDATE OF p
  `;
  const row = rows[0];
  if (!row) return null;
  const { childTaskId, ...project } = toProjectRow(row);
  return { project, taskId: childTaskId };
}

/**
 * 对用户行加 FOR NO KEY UPDATE 行锁（锁顺序最前：User → Project → …）。
 * 用于「创建项目」等无 Project 锁、需在用户级串行化配额与幂等记录的场景（docs/05 §5）。
 * 用户不存在时返回 null（由调用方决定后续处理）。
 */
export async function lockUserRow(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<{ id: string } | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE
  `;
  return rows[0] ?? null;
}
