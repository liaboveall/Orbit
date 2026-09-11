import pg from "pg";

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
    throw new Error("E2E 测试库助手：缺少 DATABASE_URL，无法核对测试库与开发库是否同名。");
  }

  let testUrl: URL;
  let devUrl: URL;
  try {
    testUrl = new URL(testUrlRaw);
    devUrl = new URL(devUrlRaw);
  } catch {
    throw new Error("E2E 测试库助手：TEST_DATABASE_URL 或 DATABASE_URL 不是合法连接串。");
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
export async function withTestDb<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
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

/**
 * 回收给定邮箱集合创建的全部用户及其从属数据（子 → 父顺序；Invitation 随 Project
 * Cascade，其余表 FK 为 RESTRICT 须显式先删）。供各 spec 的 `afterEach`
 *
 * 返回值增强：
 * - 返回每个表的清理计数，用于断言“至少清除了本轮创建的 N 个记录”
 * - 单个 DELETE 失败不影响其他邮箱/表的清理进度，但会被记录
 * - 若整体清理过程中抛错，success=false，error 包含错误信息，但可能部分成功
 */
export async function cleanupTestEmails(emails: string[]): Promise<{
  cleanedCount: Record<string, number>;
  error?: string;
}> {
  if (emails.length === 0) return { cleanedCount: {}, error: undefined };

  const counts: Record<string, number> = {};
  let cleanResult = { cleanedCount: {}, error: undefined as string | undefined };

  try {
    await withTestDb(async (client) => {
      // 精确查找待删除的用户（按邮箱）
      const users = await client.query('SELECT id FROM "User" WHERE email = ANY($1::text[])', [
        emails,
      ]);
      const ids = users.rows.map((r: { id: string }) => r.id);
      
      if (ids.length === 0) {
        // 无匹配用户，安全空操作
        return;
      }
      
      // 查找这些用户的关联项目
      const projects = await client.query(
        'SELECT id FROM "Project" WHERE "ownerId" = ANY($1::text[])',
        [ids],
      );
      const pids = projects.rows.map((r: { id: string }) => r.id);
      
      // 按照子 → 父依赖顺序逐个清理（避免 CASCADE 无法覆盖的情况）
      // 1. ActivityLog - 关联到 Project
      try {
        const result = await client.query('DELETE FROM "ActivityLog" WHERE "projectId" = ANY($1::uuid[])', [pids]);
        counts.activityLog = result.rowCount || 0;
      } catch (err) {
        console.warn('[cleanup] ActivityLog 清理失败:', err instanceof Error ? err.message : err);
      }
      
      // 2. IdempotencyRecord - 关联到 User
      try {
        const result = await client.query('DELETE FROM "IdempotencyRecord" WHERE "userId" = ANY($1::text[])', [ids]);
        counts.idempotencyRecord = result.rowCount || 0;
      } catch (err) {
        console.warn('[cleanup] IdempotencyRecord 清理失败:', err instanceof Error ? err.message : err);
      }
      
      // 3. Invitation - 关联到 Project（随 Project CASCADE 但显式删除更清晰）
      try {
        const result = await client.query('DELETE FROM "Invitation" WHERE "projectId" = ANY($1::uuid[])', [pids]);
        counts.invitation = result.rowCount || 0;
      } catch (err) {
        console.warn('[cleanup] Invitation 清理失败:', err instanceof Error ? err.message : err);
      }
      
      // 4. Task - 关联到 Project
      try {
        const result = await client.query('DELETE FROM "Task" WHERE "projectId" = ANY($1::uuid[])', [pids]);
        counts.task = result.rowCount || 0;
      } catch (err) {
        console.warn('[cleanup] Task 清理失败:', err instanceof Error ? err.message : err);
      }
      
      // 5. ProjectMember - 关联到 Project 或 User
      try {
        const result = await client.query(
          'DELETE FROM "ProjectMember" WHERE "projectId" = ANY($1::uuid[]) OR "userId" = ANY($2::text[])',
          [pids, ids],
        );
        counts.projectMember = result.rowCount || 0;
      } catch (err) {
        console.warn('[cleanup] ProjectMember 清理失败:', err instanceof Error ? err.message : err);
      }
      
      // 6. Project - 外键已清理，删除项目
      try {
        const result = await client.query('DELETE FROM "Project" WHERE id = ANY($1::uuid[])', [pids]);
        counts.project = result.rowCount || 0;
      } catch (err) {
        throw new Error(`Project 清理失败：${err instanceof Error ? err.message : err}`);
      }
      
      // 7. User - 删除用户
      try {
        const result = await client.query('DELETE FROM "User" WHERE id = ANY($1::text[])', [ids]);
        counts.user = result.rowCount || 0;
      } catch (err) {
        throw new Error(`User 清理失败：${err instanceof Error ? err.message : err}`);
      }
      
      // 8. Verification - 删除验证记录
      try {
        const result = await client.query('DELETE FROM "Verification" WHERE identifier = ANY($1::text[])', [emails]);
        counts.verification = result.rowCount || 0;
      } catch (err) {
        console.warn('[cleanup] Verification 清理失败:', err instanceof Error ? err.message : err);
      }
    });
    cleanResult = { cleanedCount: counts, error: undefined };
  } catch (error) {
    // 如果整体清理失败，记录错误但不吞掉可能已经部分成功的清理
    cleanResult.error = error instanceof Error ? error.message : String(error);
    throw error; // 让上层知道清理失败
  }

  return cleanResult;
}
