import { test, expect, type Request as PwRequest } from "@playwright/test";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { establishSessionCookies } from "../ui/auth-setup";
import { cleanupTestEmails, withTestDb } from "./support/db";

/**
 * A10 回归：项目列表「加载更多」的旧分页响应代次污染（本轮 M4 收尾工作流 2）。
 *
 * 与 tests/e2e/m4-activity.spec.ts 的同名 A10 用例对称，覆盖
 * src/features/projects/project-list-client.tsx 的同一类缺陷：resetting 分页 state
 * 在 refresh/切换 tab 时不足以防护——如果一个仍在飞行的旧「加载更多」响应在代次前移
 * 之后才落地，必须被整批丢弃（不更新 projects/cursor/hasMore/error/pending 中的任何
 * 一项），而不是继续用「按 id 去重」兜底（旧响应里的项目对新基线可能是全新 id，
 * 去重无法识别这种「看起来是新数据、实际是错误上下文」的污染）。
 *
 * 复现路径：批量注入 31 个额外项目（连同 owner 自己已有的项目触发 hasMore=true）→
 * 点击「加载更多」→ 该请求被拦截挂起 → 切换到「已归档」tab（产生新的 initialProjects
 * props 引用 + 新的 archived 筛选，等同于代次前移）→ 断言 tab 切换已经生效且「加载
 * 更多」的 pending 态已解除（不能因为旧请求还挂着就永久卡在 loading）→ 放行旧响应 →
 * 断言未归档 tab 的旧数据没有污染已归档 tab 的新首屏，且没有发生 hasMore/游标回退。
 */

dotenv.config({ path: [".env.local", ".env"], quiet: true });

const origin =
  process.env.E2E_AUTH_ORIGIN ?? `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const PAGE_SIZE = 30;

/**
 * 批量插入 count 个已归档=false 的合成项目，ownerId 为给定用户，updatedAt 严格递增
 * 且晚于「现在」，使它们在 DESC 排序里排在所有既有项目之前——从而稳定地成为
 * 首屏前 30 条，把「加载更多」按钮顶出来。
 */
async function seedProjects(ownerId: string, count: number, keyPrefix: string): Promise<void> {
  await withTestDb((client) =>
    client
      .query(
        `INSERT INTO "Project"
           (id,"ownerId",name,key,description,color,"archivedAt","updatedAt")
         SELECT gen_random_uuid(), $1, '批量项目 ' || n, $2 || lpad(n::text, 4, '0'),
                '', 'BLUE', NULL, now() + (n || ' seconds')::interval
         FROM generate_series(1,$3::int) n`,
        [ownerId, keyPrefix, count],
      )
      .then(() => undefined),
  );
}

test("A10：项目列表「加载更多」的旧分页响应在切换 tab 代次前移后落地，必须被整批丢弃", async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);

  const meta: { email?: string } = {};
  const cookies = await establishSessionCookies(request, origin, meta);
  const email = meta.email!;
  await page.context().addCookies(cookies);

  try {
    const me = await request.get("/api/v1/me");
    expect(me.status()).toBe(200);
    const userId = ((await me.json()) as { data: { id: string } }).data.id;

    const keyPrefix = `AA${Date.now().toString(36).slice(-2).toUpperCase()}`;

    // 先创建并归档探针项目：此时用户尚无其它项目，不会撞上未归档项目数量上限
    // （MAX_ACTIVE_PROJECTS=10，业务规则本身就意味着一个用户永远不可能有 31 个
    // 未归档项目——下面用原生 SQL 批量注入的 31 条是专门绕过这条业务规则、只为
    // 制造分页 UI 需要的「首屏之外还有余量」场景，不代表这是一个真实可达的业务状态）。
    const archivedRes = await request.post("/api/v1/projects", {
      headers: { origin, "Idempotency-Key": randomUUID() },
      data: { name: "唯一已归档探针项目", key: `${keyPrefix}ARC`.slice(0, 8) },
    });
    const archivedResBody = await archivedRes.json();
    expect(archivedRes.status(), JSON.stringify(archivedResBody)).toBe(201);
    const archivedProject = (archivedResBody as { data: { id: string; version: number } }).data;
    const archiveIt = await request.patch(`/api/v1/projects/${archivedProject.id}`, {
      headers: { origin },
      data: { expectedVersion: archivedProject.version, archived: true },
    });
    expect(archiveIt.status()).toBe(200);

    // 31 个未归档合成项目，绕过业务层的数量上限校验（直接原生 SQL 写入，不经过
    // create.ts 的配额检查——目的仅是制造分页场景，不是验证配额规则本身）。
    await seedProjects(userId, 31, keyPrefix);

    await page.goto("/app/projects");
    await expect(page.getByRole("heading", { name: "全部项目", exact: true })).toBeVisible();

    const cards = page.locator("main ul > li");
    await expect(cards).toHaveCount(PAGE_SIZE);

    const loadMore = page.getByRole("button", { name: "加载更多", exact: true });
    await expect(loadMore).toBeVisible();

    // 拦住「加载更多」的分页请求（projects 列表 API，不含归档 tab 的 RSC 导航）。
    let releaseStale: (() => void) | null = null;
    const staleGate = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    let staleRequestSeen = false;
    /** E5：记录被扣留的请求对象，供放行后等待其响应确实送达页面。 */
    let staleProjectRequest: PwRequest | null = null;
    await page.route(
      (url) => /\/api\/v1\/projects\?/.test(url.pathname + "?" + url.search),
      async (route) => {
        staleRequestSeen = true;
        staleProjectRequest = route.request();
        const response = await route.fetch();
        const body = await response.text();
        await staleGate;
        await route.fulfill({ response, body });
      },
    );

    await loadMore.click();
    await expect.poll(() => staleRequestSeen).toBe(true);

    // 旧请求挂起期间切换到「已归档」tab：URL 改写为 ?archived=only，Server Component
    // 用新过滤重取，产生新的 initialProjects props 引用——等同于代次前移。
    await page.getByRole("tab", { name: "已归档" }).click();
    await expect(page).toHaveURL(/\?archived=only/);

    // 已归档 tab 应该只看到那唯一的已归档探针项目（1 张卡片），且 pending 态已经解除
    // ——不能因为旧的「未归档」分页请求还没放行就让按钮永久停在「正在加载…」。
    await expect(cards).toHaveCount(1);
    await expect(page.getByText("唯一已归档探针项目", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "正在加载…" })).toHaveCount(0);
    // 已归档 tab 数据量很小，不应该出现「加载更多」（hasMore 应为 false）。
    await expect(page.getByRole("button", { name: "加载更多", exact: true })).toHaveCount(0);

    // 现在放行被挂起的「未归档」旧分页响应。E5 修复：等待旧响应确实送达页面
    // （响应事件），而非固定 sleep——慢机上迟到落地也不会漏掉污染检查。
    const staleProjectLanded = page.waitForResponse(
      (r) => r.request() === staleProjectRequest,
    );
    releaseStale!();
    await staleProjectLanded;

    // 核心断言：已归档 tab 的这 1 张卡片没有被旧响应污染成别的数量，也没有因此多出
    // 一个「加载更多」按钮（旧响应的 hasMore=true 语义没有被错误地应用到当前 tab）。
    await expect(cards).toHaveCount(1);
    await expect(page.getByText("唯一已归档探针项目", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "加载更多", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "正在加载…" })).toHaveCount(0);
  } finally {
    const result = await cleanupTestEmails([email]);
    console.log(
      `[m4-project-list] email=${email} 已清理：` +
        `清理计数=${JSON.stringify(result.cleanedCount)}${result.error ? ` (error: ${result.error})` : ''}`,
    );
    
    // 日志：显示隔离验证结果
    await withTestDb(async (client) => {
      const testCheck = await client.query('SELECT COUNT(*) FROM "Project"');
      console.log(
        `[isolation] orbit_test 清理后统计：Project=${testCheck.rows[0].count}`,
      );
    });
  }
});
