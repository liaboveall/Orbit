import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { prisma } from "@/server/db/prisma";
import { lockProjectRow, lockUserRow, withTransaction } from "@/server/db/tx";
import { createComment, updateComment } from "@/server/modules/comments/service";
import { updateTask } from "@/server/modules/task";
import { m5Fixture } from "../support/m5-fixture";

/**
 * 行锁与授权的两条不变量（docs/04 §4、docs/05 §4）：
 *
 *  1. 写事务在等项目锁期间，成员被另一事务移除并提交——拿到锁之后必须看到这次移除并拒绝写入。
 *     成员关系因此在加锁语句**之后**用单独的语句读取；写进同一条语句的子查询会沿用等锁
 *     之前的快照而放行。
 *  2. 串行锁是 FOR NO KEY UPDATE：仍与自身互斥，但不阻塞外键检查（FOR KEY SHARE）。
 *     持有用户锁的事务不会挡住别的事务写入引用该用户的活动日志。
 */

const env = process.env.TEST_DATABASE_URL!;
const pool = new pg.Pool({ connectionString: env.replace("localhost", "127.0.0.1"), max: 3 });

let f: Awaited<ReturnType<typeof m5Fixture>>;
beforeEach(async () => {
  f = await m5Fixture();
});
afterEach(async () => {
  await f.cleanup();
});
afterAll(async () => {
  await pool.end();
});

/** 等到至少一个别的会话在等锁，且它的语句是对 Project 行加锁的那一条。 */
async function waitForProjectLockWaiter(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const found = await pool.query<{ count: string }>(
      `SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock' AND query LIKE '%FROM "Project"%NO KEY UPDATE%'`,
    );
    if (Number(found.rows[0]!.count) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("no session queued on the project lock");
}

/**
 * 另一条连接持有项目行锁并移除成员；被测写入排队等锁，随后移除提交。
 * 返回被测写入的结果（成功或拒绝）。
 */
async function writeWhileMemberIsRemoved<T>(write: () => Promise<T>): Promise<PromiseSettledResult<T>> {
  const remover = await pool.connect();
  try {
    await remover.query("BEGIN");
    await remover.query('SELECT id FROM "Project" WHERE id = $1::uuid FOR UPDATE', [f.projectId]);
    await remover.query('UPDATE "Task" SET "assigneeId" = NULL WHERE "projectId" = $1::uuid AND "assigneeId" = $2', [f.projectId, f.member]);
    await remover.query('DELETE FROM "ProjectMember" WHERE "projectId" = $1::uuid AND "userId" = $2', [f.projectId, f.member]);
    const pending = Promise.allSettled([write()]);
    await waitForProjectLockWaiter();
    await remover.query("COMMIT");
    return (await pending)[0]!;
  } catch (error) {
    await remover.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    remover.release();
  }
}

describe("authorization is decided after the project lock is held", () => {
  it("a task update queued behind a member removal is rejected once it gets the lock", async () => {
    const task = await prisma.task.findUniqueOrThrow({ where: { id: f.taskId } });
    const result = await writeWhileMemberIsRemoved(() =>
      updateTask(f.taskId, f.member, { expectedVersion: task.version, title: "移除后不应写入" }),
    );
    expect(result.status).toBe("rejected");
    expect((result as PromiseRejectedResult).reason).toMatchObject({ code: "NOT_FOUND" });
    const after = await prisma.task.findUniqueOrThrow({ where: { id: f.taskId } });
    expect(after.title).toBe(task.title);
    expect(after.version).toBe(task.version);
    expect(await prisma.activityLog.count({ where: { projectId: f.projectId } })).toBe(0);
  });

  it("a comment create that locates the project through the task is rejected the same way", async () => {
    const result = await writeWhileMemberIsRemoved(() =>
      createComment(f.taskId, f.member, { body: "移除后不应发布" }, randomUUID()),
    );
    expect(result.status).toBe("rejected");
    expect((result as PromiseRejectedResult).reason).toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.comment.count({ where: { taskId: f.taskId } })).toBe(0);
  });

  it("a comment edit that locates the project through the comment is rejected the same way", async () => {
    const { comment } = await createComment(f.taskId, f.member, { body: "原文" }, randomUUID());
    const result = await writeWhileMemberIsRemoved(() =>
      updateComment(comment.id, f.member, { expectedVersion: comment.version, body: "移除后不应改写" }),
    );
    expect(result.status).toBe("rejected");
    expect((result as PromiseRejectedResult).reason).toMatchObject({ code: "NOT_FOUND" });
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: comment.id } })).body).toBe("原文");
  });
});

describe("serialising locks do not block foreign-key checks", () => {
  it("holding the user lock lets another transaction insert rows that reference that user", async () => {
    const other = await pool.connect();
    try {
      await withTransaction(async (tx) => {
        expect(await lockUserRow(tx, f.owner)).toEqual({ id: f.owner });
        // 另一条连接写入引用该用户的活动行：外键检查取 KEY SHARE，不应等待。
        await other.query("BEGIN");
        await other.query("SET LOCAL lock_timeout = '1000ms'");
        await other.query(
          `INSERT INTO "ActivityLog" ("projectId", "actorId", "entityType", "entityId", action)
           VALUES ($1::uuid, $2, 'TASK', $3, 'TASK_UPDATED')`,
          [f.projectId, f.owner, f.taskId],
        );
        await other.query("ROLLBACK");
      });
    } finally {
      other.release();
    }
  });

  it("the project lock still excludes a second writer", async () => {
    const other = await pool.connect();
    try {
      await withTransaction(async (tx) => {
        expect((await lockProjectRow(tx, f.projectId))?.id).toBe(f.projectId);
        await other.query("BEGIN");
        await other.query("SET LOCAL lock_timeout = '300ms'");
        await expect(
          other.query('SELECT id FROM "Project" WHERE id = $1::uuid FOR NO KEY UPDATE', [f.projectId]),
        ).rejects.toMatchObject({ code: "55P03" });
        await other.query("ROLLBACK");
      });
    } finally {
      other.release();
    }
  });
});
