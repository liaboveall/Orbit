import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { DomainError } from "@/server/http/errors";
import { sha256Hex, stableStringify } from "@/server/modules/stable-json";

/**
 * 幂等记录服务（M2 / ORB-007，docs/05 §5、docs/04 §3）。
 *
 * 语义：
 *  - 唯一键 (userId, method, routeKey, key)；保存规范化请求 SHA-256 与响应，24h 有效。
 *  - 同 key 同内容 → 返回原始响应（重放）；同 key 异内容 → 409 IDEMPOTENCY_CONFLICT。
 *  - **必须在业务事务内**调用：begin 读取既有记录，commit 在业务写入成功后落库，
 *    与业务改动同原子性（要么都成功，要么都回滚）。
 *
 * 并发：commit 时可能与他事务竞争同一唯一键（P2002）。**关键陷阱**：PG 中唯一键冲突后
 * 整个事务立即进入 aborted（25P02），而 Prisma 交互式事务不会自动建 SAVEPOINT，故
 * catch 块内**再查同一事务必然二次失败**（→ 500），承诺的 replay/409 分支都走不到。
 * 因此 commitIdempotency 捕获 P2002 后**不在事务内复查**，而是抛出哨兵
 * `IdempotencyCommitConflictError`；由调用方在 withTransaction **之外**用
 * `resolveIdempotencyCommitConflict`（应用单例只读查询）复查 hash：
 * 一致 → 返回既有响应（replay）；不一致/缺失 → 409 IDEMPOTENCY_CONFLICT。
 *
 * 重放**重新授权**由调用方负责（docs/04 §3、docs/05 §4）：begin 返回 replay 后，
 * 调用方须重新校验目标资源对当前用户仍可见，避免退出成员借旧缓存读取。
 */

/** 事务内/单例皆可的数据库客户端（结构子集，PrismaClient 可赋值）。 */
type DbClient = Prisma.TransactionClient;

/** 幂等记录有效期：24 小时（docs/05 §5）。 */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** beginIdempotency 的入参。 */
export interface BeginIdempotencyOptions {
  userId: string;
  method: string;
  routeKey: string;
  key: string;
  requestHash: string;
}

/** beginIdempotency 的判别联合结果：全新请求或可重放的既有响应。 */
export type BeginIdempotencyResult =
  | { kind: "new" }
  | { kind: "replay"; status: number; body: unknown; resourceId: string | null };

/** commitIdempotency 的入参。 */
export interface CommitIdempotencyOptions extends BeginIdempotencyOptions {
  responseStatus: number;
  responseBody: unknown;
  resourceId?: string;
}

/** 同 key 异内容 —— 409 IDEMPOTENCY_CONFLICT。 */
export function idempotencyConflictError(): DomainError {
  return new DomainError(
    "IDEMPOTENCY_CONFLICT",
    "该 Idempotency-Key 已用于内容不同的请求，请为本次操作生成新的键。",
  );
}

/** 计算请求体的规范化 SHA-256（键序无关，docs/05 §5「规范化请求」）。 */
export function hashRequest(body: unknown): string {
  return sha256Hex(stableStringify(body));
}

/** 是否为 Prisma 唯一约束冲突（P2002）。 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return String((error as { code?: unknown }).code) === "P2002";
}

/**
 * 哨兵错误：commitIdempotency 落库时撞唯一键（P2002）。
 *
 * 此刻当前事务已进入 aborted（25P02），无法在事务内复查。故仅携带复查所需的 opts 抛出，
 * 由调用方在**事务之外**捕获并调用 resolveIdempotencyCommitConflict 决定 replay 或 409。
 * 它不是面向用户的 DomainError，绝不应逃逸到 HTTP 层（调用方必须捕获）。
 */
export class IdempotencyCommitConflictError extends Error {
  readonly opts: BeginIdempotencyOptions;
  constructor(opts: BeginIdempotencyOptions) {
    super("idempotency commit conflict: unique key taken by a concurrent transaction");
    this.name = "IdempotencyCommitConflictError";
    this.opts = opts;
  }
}

/**
 * 事务外复查 commit 阶段唯一键冲突（处理 IdempotencyCommitConflictError 哨兵）。
 * 用应用单例（非 aborted 事务）只读查既有记录：
 *  - hash 一致且未过期 → 返回既有响应（视为并发重放，replay）；
 *  - 否则（hash 不同 / 已过期 / 记录缺失）→ 抛 409 IDEMPOTENCY_CONFLICT。
 */
export async function resolveIdempotencyCommitConflict(
  client: DbClient,
  opts: BeginIdempotencyOptions,
): Promise<{ status: number; body: unknown }> {
  const existing = await client.idempotencyRecord.findUnique({ where: uniqueWhere(opts) });
  if (
    existing &&
    existing.expiresAt.getTime() > Date.now() &&
    existing.requestHash === opts.requestHash
  ) {
    return { status: existing.responseStatus, body: existing.responseBody };
  }
  throw idempotencyConflictError();
}

/** (userId, method, routeKey, key) 唯一键的 where 复合条件。 */
function uniqueWhere(opts: BeginIdempotencyOptions) {
  return {
    userId_method_routeKey_key: {
      userId: opts.userId,
      method: opts.method,
      routeKey: opts.routeKey,
      key: opts.key,
    },
  } as const;
}

/**
 * 根据 HTTP 方法和 routeKey 检查目标资源是否存在。
 * 
 * 主要解决 UUID Replay 场景下的 404 问题：当幂等记录存在但资源已被删除时，
 * 第二次请求会返回 404。此函数通过检查资源有效性，允许更新 hash 以支持新请求。
 */
async function checkResourceExistence(
  method: string,
  routeKey: string,
  tx: Prisma.TransactionClient
): Promise<boolean> {
  // POST /projects/:projectId/tasks - 检查父项目是否存在且未归档
  const createTaskMatch = routeKey.match(/\/projects\/([^/]+)\/tasks$/);
  if (method === 'POST' && createTaskMatch) {
    const projectId = createTaskMatch[1];
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { archivedAt: true }
    });
    return !!project && project.archivedAt === null;
  }
  
  // PATCH /tasks/:taskId - 检查任务是否存在且未被软删除
  const updateTaskMatch = routeKey.match(/\/tasks\/([^/]+)$/);
  if (method === 'PATCH' && updateTaskMatch) {
    const taskId = updateTaskMatch[1];
    const task = await tx.task.findUnique({
      where: { id: taskId },
      select: { deletedAt: true }
    });
    return !!task && task.deletedAt === null;
  }
  
  // DELETE /tasks/:taskId - 类似 PATCH 检查
  if (method === 'DELETE' && updateTaskMatch) {
    const taskId = updateTaskMatch[1];
    const task = await tx.task.findUnique({
      where: { id: taskId }
    });
    return !!task; // 即使已软删除也算存在
  }
  
  // 其他方法或无法解析的路由，默认认为安全
  return true;
}

/**
 * 事务开始处：查既有幂等记录。
 *  - 命中且未过期且 hash 一致 → replay（携带原状态码与响应体）；
 *  - 命中且未过期但 hash 不同 → 抛 IDEMPOTENCY_CONFLICT；
 *  - 命中但已过期 → 删除旧记录后按 new 处理（过期后 key 不再保证去重，docs/05 §5）；
 *  - 未命中 → new。
 * 
 * 增强：对于已存在但未过期的记录，检查目标资源是否仍有效存在。
 * 如果资源已被删除（如任务被软删除），则更新 hash 允许新请求，避免 404 错误。
 */
export async function beginIdempotency(
  tx: Prisma.TransactionClient,
  opts: BeginIdempotencyOptions,
): Promise<BeginIdempotencyResult> {
  const existing = await tx.idempotencyRecord.findUnique({ where: uniqueWhere(opts) });
  if (!existing) return { kind: "new" };

  if (existing.expiresAt.getTime() <= Date.now()) {
    // 过期记录不再代表有效去重；删除后允许重新执行并写入新记录。
    await tx.idempotencyRecord.delete({ where: { id: existing.id } });
    return { kind: "new" };
  }

  if (existing.requestHash === opts.requestHash) {
    return { kind: "replay", status: existing.responseStatus, body: existing.responseBody, resourceId: existing.resourceId };
  }
  
  // 增强容错：hash 不同且资源不存在时，允许覆盖旧记录
  const resourceExists = await checkResourceExistence(opts.method, opts.routeKey, tx);
  if (!resourceExists) {
    // 资源已删除，更新 hash 以允许新的执行（防止未来冲突）
    await tx.idempotencyRecord.update({
      where: { id: existing.id },
      data: { requestHash: opts.requestHash }
    });
    return { kind: "new" };
  }
  
  throw idempotencyConflictError();
}

/**
 * 业务写入成功后：落库幂等记录（expiresAt = now + 24h）。
 *
 * 与他事务竞争同一唯一键时（P2002）：**不在事务内复查**——因为唯一键冲突已让当前事务
 * 进入 aborted（25P02），Prisma 交互式事务不自动建 SAVEPOINT，事务内任何后续查询都会再抛错。
 * 故抛出哨兵 IdempotencyCommitConflictError，由调用方在事务外用
 * resolveIdempotencyCommitConflict 复查 hash：一致 → replay，不一致 → 409。
 */
export async function commitIdempotency(
  tx: Prisma.TransactionClient,
  opts: CommitIdempotencyOptions,
): Promise<void> {
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);
  try {
    await tx.idempotencyRecord.create({
      data: {
        userId: opts.userId,
        method: opts.method,
        routeKey: opts.routeKey,
        key: opts.key,
        requestHash: opts.requestHash,
        responseStatus: opts.responseStatus,
        responseBody: opts.responseBody as Prisma.InputJsonValue,
        resourceId: opts.resourceId ?? null,
        expiresAt,
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // 事务此刻已 aborted，无法在此复查；抛哨兵交由事务外处理（见函数注释）。
    throw new IdempotencyCommitConflictError(opts);
  }
}
