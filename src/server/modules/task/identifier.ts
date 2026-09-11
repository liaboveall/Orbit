import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { DomainError } from "@/server/http/errors";

/**
 * 任务编号辅助（M2 / ORB-008，docs/01 §6、docs/04 §3/§4）。
 *
 * 任务编号在**项目内**递增，已删除编号不复用；identifier 形如 `ORB-12`（projectKey-number）。
 * 计数器 Project.nextTaskNumber 的取号与递增必须在 Project 行锁事务内原子完成，
 * 用单条 `UPDATE ... RETURNING` 避免读-改-写竞争（docs/04 §4）。
 */

/** nextTaskNumber 缺失（项目行不存在）时的兜底错误；正常路径已由调用方先锁到项目行。 */
function projectRowMissingError(): DomainError {
  return new DomainError("NOT_FOUND", "项目不存在或你无权访问。");
}

/**
 * 在 Project 行锁事务内取出并递增 nextTaskNumber，返回**本次分配**的编号（递增前的原值）。
 *
 * 单条 `UPDATE ... RETURNING "nextTaskNumber" - 1`：既递增计数器又回传分配值，天然原子。
 * 不 bump Project.updatedAt（编号推进属任务域内部计数，非项目资料变更，docs/04 §4）。
 */
export async function nextTaskNumber(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ assigned: number }[]>`
    UPDATE "Project" SET "nextTaskNumber" = "nextTaskNumber" + 1
    WHERE id = ${projectId}::uuid
    RETURNING "nextTaskNumber" - 1 AS assigned
  `;
  const row = rows[0];
  if (row === undefined) throw projectRowMissingError();
  return Number(row.assigned);
}

/** 格式化任务标识符：`${projectKey}-${number}`（如 `ORB-1`）。 */
export function formatIdentifier(projectKey: string, number: number): string {
  return `${projectKey}-${number}`;
}
