import pg from "pg";
import { assertFixtureUsersOwned } from "../../support/fixture-ownership";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

/**
 * tests/e2e/support/db.ts —— E2E 专用测试库直连助手（A10 修复）。
 *
 * 背景：此前 5 个 E2E spec 文件各自内联了一份几乎相同的 `db()` helper，全部连接
 * `process.env.DATABASE_URL` 并硬编码要求数据库名为 `orbit_dev`——与
 * `scripts/e2e-server.mjs` 现在把测试服务器指向 `TEST_DATABASE_URL`（orbit_test）
 * 的事实不再一致：spec 文件会往 orbit_dev 写入清理 SQL，而应用本身读写的是
 * orbit_test，二者完全对不上，清理形同虚设且仍在污染开发库。
 *
 * 修复：统一改为连接 `TEST_DATABASE_URL`，并且**运行前验证**：
 *  1. 目标必须是本机地址；
 *  2. 目标数据库名不得与 `DATABASE_URL`（开发库）相同——防止 `.env.local` 被误改成
 *     两者同名时静默把清理 SQL 又对准了开发库；
 *  3. 连接后重新查询 `current_database()` 核对，防止连接串遭代理/重写。
 *
 * 任何一项校验失败都会抛出异常并中止用例（fail fast），不会静默回退到某个默认值。
 */

let cachedTarget: { url: URL; dbName: string } | null = null;

function resolveVerifiedTestTarget(): { url: URL; dbName: string } {
  if (cachedTarget) return cachedTarget;

  const testUrlRaw = process.env.TEST_DATABASE_URL;
  const devUrlRaw = process.env.DATABASE_URL;
  if (!testUrlRaw) {
    throw new Error(
      "E2E 测试库助手：缺少 TEST_DATABASE_URL，拒绝运行（不会回退到 DATABASE_URL/开发库）。",
    );
  }
  if (!devUrlRaw) {
    throw new Error(
      "E2E 测试库助手：缺少 DATABASE_URL，无法核对测试库与开发库是否同名。",
    );
  }

  let testUrl: URL;
  let devUrl: URL;
  try {
    testUrl = new URL(testUrlRaw);
    devUrl = new URL(devUrlRaw);
  } catch {
    throw new Error(
      "E2E 测试库助手：TEST_DATABASE_URL 或 DATABASE_URL 不是合法连接串。",
    );
  }

  if (!["localhost", "127.0.0.1"].includes(testUrl.hostname)) {
    throw new Error(
      `E2E 测试库助手：TEST_DATABASE_URL 主机（${testUrl.hostname}）不是本机，拒绝连接远程库。`,
    );
  }

  const testDbName = testUrl.pathname.replace(/^\//, "");
  const devDbName = devUrl.pathname.replace(/^\//, "");
  if (!testDbName) {
    throw new Error("E2E 测试库助手：TEST_DATABASE_URL 缺少数据库名。");
  }
  if (testDbName === devDbName) {
    throw new Error(
      `E2E 测试库助手：TEST_DATABASE_URL 与 DATABASE_URL 指向同一个数据库（${testDbName}），` +
        " 拒绝运行以避免清理/注入 SQL 误伤开发库。",
    );
  }

  cachedTarget = { url: testUrl, dbName: testDbName };
  return cachedTarget;
}

/**
 * 在**已核验的独立测试库**上执行一次数据库操作。
 *
 * @param run 接收已连接的 pg.Client 的回调；返回值原样透传。
 */
export async function withTestDb<T>(
  run: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const target = resolveVerifiedTestTarget();
  const client = new pg.Client({ connectionString: target.url.href });
  await client.connect();
  try {
    const check = await client.query("SELECT current_database() AS db");
    if (check.rows[0]?.db !== target.dbName) {
      throw new Error(
        `E2E 测试库助手：连接后实际数据库（${check.rows[0]?.db}）与声明的（${target.dbName}）不一致，拒绝继续。`,
      );
    }
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Transactional, exact-email fixture cleanup. Any failure fails the test. */
export async function cleanupTestEmails(
  emails: string[],
): Promise<{ cleanedCount: Record<string, number>; error?: string }> {
  const counts: Record<string, number> = {};
  if (!emails.length) return { cleanedCount: counts };
  await withTestDb(async (client) => {
    await client.query("BEGIN");
    try {
      const users = await client.query<{ id: string; createdAt: Date }>(
        'SELECT id, "createdAt" FROM "User" WHERE email=ANY($1::text[]) FOR UPDATE',
        [emails],
      );
      const ids = users.rows.map((row) => row.id);
      await assertFixtureUsersOwned(users.rows);
      const projects = await client.query<{ id: string }>(
        'SELECT id FROM "Project" WHERE "ownerId"=ANY($1::text[])',
        [ids],
      );
      const pids = projects.rows.map((row) => row.id);
      const attachments = await client.query<{ objectKey: string }>(
        'SELECT "objectKey" FROM "Attachment" WHERE "projectId"=ANY($1::uuid[])',
        [pids],
      );
      if (attachments.rows.length) {
        const endpoint = process.env.STORAGE_ENDPOINT;
        if (
          !endpoint ||
          !["localhost", "127.0.0.1"].includes(new URL(endpoint).hostname)
        )
          throw new Error("E2E attachment cleanup requires local storage");
        const storage = new S3Client({
          endpoint,
          region: process.env.STORAGE_REGION,
          forcePathStyle: true,
          credentials: {
            accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
            secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
          },
        });
        try {
          for (const file of attachments.rows)
            await storage.send(
              new DeleteObjectCommand({
                Bucket: process.env.STORAGE_BUCKET,
                Key: file.objectKey,
              }),
              { abortSignal: AbortSignal.timeout(15000) },
            );
        } finally {
          storage.destroy();
        }
      }
      await client.query(
        'DELETE FROM "Attachment" WHERE "projectId"=ANY($1::uuid[])',
        [pids],
      );
      for (const table of ["Subtask", "Comment", "MoveRecord"]) {
        await client.query(
          `DELETE FROM "${table}" WHERE "taskId" IN (SELECT id FROM "Task" WHERE "projectId"=ANY($1::uuid[]))`,
          [pids],
        );
      }
      for (const table of ["ActivityLog", "Invitation", "Task"]) {
        counts[table] =
          (
            await client.query(
              `DELETE FROM "${table}" WHERE "projectId"=ANY($1::uuid[])`,
              [pids],
            )
          ).rowCount ?? 0;
      }
      counts.idempotencyRecord =
        (
          await client.query(
            'DELETE FROM "IdempotencyRecord" WHERE "userId"=ANY($1::text[])',
            [ids],
          )
        ).rowCount ?? 0;
      await client.query(
        'DELETE FROM "ProjectMember" WHERE "projectId"=ANY($1::uuid[]) OR "userId"=ANY($2::text[])',
        [pids, ids],
      );
      counts.project =
        (
          await client.query('DELETE FROM "Project" WHERE id=ANY($1::uuid[])', [
            pids,
          ])
        ).rowCount ?? 0;
      counts.user =
        (
          await client.query('DELETE FROM "User" WHERE id=ANY($1::text[])', [
            ids,
          ])
        ).rowCount ?? 0;
      await client.query(
        // 重置令牌的 identifier 是 `reset-password:<token>`（不含邮箱），须按用户归属删除，
        // 与 tests/support/auth-cleanup.ts 的集成侧规则一致（C4 修复）。
        `DELETE FROM "Verification" WHERE identifier=ANY($1::text[])
           OR (value=ANY($2::text[]) AND identifier LIKE 'reset-password:%')`,
        [emails, ids],
      );
      const remaining = await client.query(
        'SELECT id FROM "User" WHERE email=ANY($1::text[])',
        [emails],
      );
      if (remaining.rowCount)
        throw new Error("Fixture cleanup left users behind");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
  return { cleanedCount: counts };
}
