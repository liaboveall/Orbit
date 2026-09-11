import {
  test,
  expect,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import {
  ProjectSchema,
  SuccessResponseSchema,
  type ProjectDTO,
} from "../../src/contracts";
import { establishSessionCookies } from "../ui/auth-setup";
import { cleanupTestEmails, withTestDb } from "./support/db";

/**
 * M4 / ORB-011 + ORB-007：项目活动时间线与归档/恢复 E2E（真实浏览器）。
 *
 * 覆盖任务 Part 4：
 *  1. owner 登录 → 打开项目活动页（h1「项目活动」）→ 校验既有动作已展示；
 *  2. 「加载更多」分页（首屏 30 条，注入合成活动使 hasMore=true → 点击追加 → 36 条后按钮消失）；
 *  3. 打开项目设置 → 归档项目（二次确认对话框）→ 校验只读态（按钮转「恢复项目」+ 只读提示）；
 *  4. 恢复项目（二次确认对话框）→ 校验回到可编辑态；
 *  5. 回到活动页 → 归档/恢复动作被记录（「归档了项目」「恢复了项目」可见）。
 *
 * 与 m3-workflows / m4-invitations / m4-members 同一套基础设施：establishSessionCookies 走
 * 真实注册 → Mailpit 验证 → autoSignIn 链路取得 session cookie 注入浏览器上下文；合成活动用
 * 原生 SQL 直接写入 **独立测试库**（TEST_DATABASE_URL，见 tests/e2e/support/db.ts，A10
 * 修复：此前直连 DATABASE_URL/orbit_dev，与测试服务器实际连接的库脱节）；数据副作用在
 * afterEach 精确回收。
 *
 * ⚠️ 运行前置：`pnpm test:e2e` 会通过 scripts/e2e-server.mjs 自建连接 orbit_test 的测试
 * 服务；Mailpit 均需在线；否则用例失败（属预期）。
 * ⚠️ 活动页 <ol> 与侧栏 <ul> 同为 listitem 角色，故计数一律限定在 main 内的 ol > li。
 */

dotenv.config({ path: [".env.local", ".env"], quiet: true });
test.describe.configure({ mode: "serial" });

/** Better Auth 受信源：POST 端点 Origin 头须命中它（与 auth-setup 一致）。默认端口 3100，
 * 对齐 scripts/e2e-server.mjs 的 E2E_PORT 默认值（测试专用服务，与开发服务器的 3000 分开）。 */
const origin = process.env.E2E_AUTH_ORIGIN ?? `http://localhost:${process.env.E2E_PORT ?? "3100"}`;

/** 首屏页大小（ActivityFeed / activity page 均为 30）。 */
const PAGE_SIZE = 30;

let project: ProjectDTO;
/** owner（User A）的 userId，注入合成活动时作为 actorId。 */
let ownerUserId = "";
/** 本次用例在库中留下的全部用户邮箱，afterEach 精确回收。 */
let createdEmails: string[] = [];

/** 以当前会话经 API 创建项目（统一信封 → ProjectDTO）。 */
async function createProject(request: APIRequestContext, name: string): Promise<ProjectDTO> {
  const res = await request.post("/api/v1/projects", {
    headers: { origin, "Idempotency-Key": randomUUID() },
    data: { name, key: "M" + randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase() },
  });
  expect(res.status()).toBe(201);
  return SuccessResponseSchema(ProjectSchema).parse(await res.json()).data;
}

/**
 * 注入 count 条合成 TASK_CREATED 活动，createdAt 严格递增且晚于建项目时刻
 * （now()+n 秒），使它们在 DESC 时间线里排在 PROJECT_CREATED 之前。
 * 用于把活动总数顶过首屏 PAGE_SIZE，触发「加载更多」按钮。
 */
async function seedActivities(projectId: string, actorId: string, count: number): Promise<void> {
  await withTestDb((client) =>
    client
      .query(
        `INSERT INTO "ActivityLog" (id,"projectId","actorId","entityType","entityId",action,"createdAt")
         SELECT gen_random_uuid(),$1::uuid,$2,'TASK','synthetic-'||n,'TASK_CREATED',
                now() + (n || ' seconds')::interval
         FROM generate_series(1,$3::int) n`,
        [projectId, actorId, count],
      )
      .then(() => undefined),
  );
}

test.beforeEach(async ({ request, context, baseURL }) => {
  createdEmails = [];
  ownerUserId = "";
  const metaA: { email?: string } = {};
  const cookiesA = await establishSessionCookies(request, baseURL!, metaA);
  createdEmails.push(metaA.email!);
  await context.addCookies(cookiesA);
  const me = await request.get("/api/v1/me");
  expect(me.status()).toBe(200);
  ownerUserId = ((await me.json()) as { data: { id: string } }).data.id;
  project = await createProject(request, "M4 活动与归档项目");
});

test.afterEach(async () => {
  const result = await cleanupTestEmails(createdEmails);
  console.log(
    `[m4-activity] beforeEach 创建的 ${createdEmails.length} 个邮箱已清理：` +
      `清理计数=${JSON.stringify(result.cleanedCount)}${result.error ? ` (error: ${result.error})` : ''}`,
  );
  createdEmails = [];
  
  // 日志：显示隔离验证结果
  await withTestDb(async (client) => {
    const testCheck = await client.query('SELECT COUNT(*) FROM "Project"');
    console.log(
      `[isolation] orbit_test 清理后统计：Project=${testCheck.rows[0].count}`,
    );
  });
});

test("活动时间线：既有动作展示 + 「加载更多」分页追加", async ({ page }) => {
  test.setTimeout(300_000);

  // 注入 35 条合成活动：连同建项目的 PROJECT_CREATED 共 36 条（> 首屏 30）→ hasMore=true。
  await seedActivities(project.id, ownerUserId, 35);

  await page.goto(`/app/projects/${project.id}/activity`);
  await expect(page.getByRole("heading", { name: "项目活动", exact: true })).toBeVisible();

  // 活动时间线限定在 main 内的 ol > li（避开侧栏 <ul> 的 listitem）。
  const items = page.locator("main ol > li");
  await expect(items).toHaveCount(PAGE_SIZE);

  // 「加载更多」按钮可见 → 点击后追加余下 6 条（36 条），按钮随之消失。
  const loadMore = page.getByRole("button", { name: "加载更多", exact: true });
  await expect(loadMore).toBeVisible();
  await loadMore.click();
  await expect(items).toHaveCount(36);
  await expect(loadMore).toHaveCount(0);

  // 全部加载后，最旧的「创建了项目」（PROJECT_CREATED）出现在时间线末尾。
  await expect(page.getByText("创建了项目", { exact: true }).first()).toBeVisible();
});

test("项目归档与恢复：设置页二次确认 + 只读态切换 + 活动留痕", async ({ page }) => {
  test.setTimeout(300_000);

  /* ── 归档项目 ─────────────────────────────────────────────────────── */
  await page.goto(`/app/projects/${project.id}/settings`);
  await expect(page.getByRole("heading", { name: "项目设置", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "归档项目", exact: true }).click();
  const archiveDialog = page.getByRole("dialog", { name: "归档项目" });
  await expect(archiveDialog).toBeVisible();
  await archiveDialog.getByRole("button", { name: "确认归档", exact: true }).click();

  // 归档后进入只读态：按钮转「恢复项目」，资料区显示只读提示。
  await expect(
    page.getByRole("button", { name: "恢复项目", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("项目已归档，处于只读状态。恢复项目后才能编辑资料。", { exact: true }),
  ).toBeVisible();

  /* ── 恢复项目 ─────────────────────────────────────────────────────── */
  await page.getByRole("button", { name: "恢复项目", exact: true }).click();
  const restoreDialog = page.getByRole("dialog", { name: "恢复项目" });
  await expect(restoreDialog).toBeVisible();
  await restoreDialog.getByRole("button", { name: "确认恢复", exact: true }).click();

  // 恢复后回到可编辑态：按钮转回「归档项目」，只读提示消失。
  await expect(
    page.getByRole("button", { name: "归档项目", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("项目已归档，处于只读状态。恢复项目后才能编辑资料。", { exact: true }),
  ).toHaveCount(0);

  /* ── 活动留痕：归档/恢复动作被记录 ─────────────────────────────────── */
  await page.goto(`/app/projects/${project.id}/activity`);
  await expect(page.getByRole("heading", { name: "项目活动", exact: true })).toBeVisible();
  await expect(page.getByText("归档了项目", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("恢复了项目", { exact: true }).first()).toBeVisible();
});

/**
 * A05 回归（docs/reviews/M0-M4-DEEP-AUDIT-2026-09-10.md）：后台刷新（focus 触发）必须让
 * 停留在活动页的用户看到新产生的活动，而不是停在挂载时的旧首屏快照。
 *
 * 复现方式：打开只有 1 条记录（PROJECT_CREATED）的活动页，不刷新/不导航，经 API 创建一个
 * 任务产生第 2 条 TASK_CREATED 活动，再触发 window 的 focus 事件（模拟切回标签页）触发
 * useAutoRefresh 的 router.refresh()；断言可见条目数从 1 变为 2。
 *
 * 此前的缺陷根因：ActivityFeed 用 useState(initialActivities) 只在挂载时读一次 props，
 * refresh 带来的新 props 从未被重新同步进 state，导致页面永久停在旧数据。
 */
test("A05：活动页 focus 触发的后台刷新必须显示新产生的活动", async ({ page, request }) => {
  await page.goto(`/app/projects/${project.id}/activity`);
  await expect(page.getByRole("heading", { name: "项目活动", exact: true })).toBeVisible();

  const items = page.locator("main ol > li");
  await expect(items).toHaveCount(1); // 仅 PROJECT_CREATED

  const created = await request.post(`/api/v1/projects/${project.id}/tasks`, {
    headers: { origin, "Idempotency-Key": randomUUID() },
    data: { title: "A05 刷新探针" },
  });
  expect(created.status()).toBe(201);

  // 等待 focus 触发的 RSC refresh 请求真正完成，再断言 DOM，避免竞态误判。
  const refreshed = page.waitForResponse(
    (r) =>
      r.url().includes(`/projects/${project.id}/activity`) &&
      r.request().headers()["rsc"] === "1",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;

  await expect(items).toHaveCount(2, { timeout: 5000 });
  await expect(page.getByText("创建了任务", { exact: true }).first()).toBeVisible();
});

/**
 * A06 回归（docs/reviews/M0-M4-DEEP-AUDIT-2026-09-10.md）：项目设置表单在版本冲突后重试
 * 保存，绝不能用本窗口未编辑字段的旧草稿覆盖远端在冲突窗口内写入的新值。
 *
 * 复现方式：本窗口只修改名称；用另一条独立请求把描述改为一个已知字符串（制造冲突并让
 * 服务端 version 前进）；点击保存 → 409 提示；再次点击保存 → 断言：
 *  1. 第二次提交只带真正被本窗口修改的字段（name），不携带 description；
 *  2. 请求成功（200）；
 *  3. 远端的描述仍是另一条请求写入的值，没有被本窗口的旧草稿覆盖。
 *
 * 此前的缺陷根因：表单把 profileDirty 与提交体都算在 project.version/name/description
 * 上，冲突后仅 router.refresh() 更新 project.version 就无条件重新提交 {name, description}，
 * 用本窗口从未修改过的旧 description 覆盖了远端刚写入的新值。
 */
test("A06：设置页冲突重试保存，不得用未编辑字段的旧草稿覆盖远端新值", async ({ page, request }) => {
  await page.goto(`/app/projects/${project.id}/settings`);
  await expect(page.getByRole("heading", { name: "项目设置", exact: true })).toBeVisible();

  await page.getByLabel("项目名称", { exact: true }).fill("本地仅改名称");

  // 独立请求：制造并发冲突，把描述改为远端必须保留的值（expectedVersion=1 是项目刚创建
  // 时的初始版本，此刻仍是当前版本，故这次请求会先于本窗口保存成功）。
  const conflicting = await request.patch(`/api/v1/projects/${project.id}`, {
    headers: { origin },
    data: { expectedVersion: 1, description: "远端必须保留的描述" },
  });
  expect(conflicting.status()).toBe(200);

  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(
    page.getByText(
      "项目已被他人更新。你的输入已保留，请核对下方远端最新内容后决定是否覆盖再保存。",
      { exact: true },
    ),
  ).toBeVisible();
  // 冲突提示同时展示远端最新描述供核对（不自动合并进输入框）。
  await expect(page.getByText("远端必须保留的描述", { exact: true }).first()).toBeVisible();

  const retryResponse = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/v1/projects/${project.id}`),
  );
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  const retrySettled = await retryResponse;
  const retryBody = retrySettled.request().postDataJSON() as Record<string, unknown>;
  // 核心断言：重试提交只带真正被编辑的字段（name），不携带未修改的 description。
  expect(retryBody).toHaveProperty("name");
  expect(retryBody).not.toHaveProperty("description");
  expect(retrySettled.status()).toBe(200);

  const current = await request.get(`/api/v1/projects/${project.id}`);
  const currentData = SuccessResponseSchema(ProjectSchema).parse(await current.json()).data;
  expect(currentData.description).toBe("远端必须保留的描述");
  expect(currentData.name).toBe("本地仅改名称");
});

/**
 * A08 回归（docs/reviews/M0-M4-DEEP-AUDIT-2026-09-10.md）：项目归档后离开列表页，
 * 必须能通过「已归档」tab 重新找到该项目并进入恢复入口，不能只靠已知 URL 才能触达。
 *
 * 完整流程：归档项目 → 导航离开到 /app/projects（默认 tab，未归档）→ 断言项目不在列表
 * → 切换到「已归档」tab（URL 带 ?archived=only）→ 断言项目出现且有「恢复项目」按钮
 * → 点击恢复 → 断言项目从「已归档」tab 消失、出现在默认「未归档」tab、且可再次编辑。
 */
test("A08：归档→离开列表→已归档 tab 找回→恢复的完整流程", async ({ page }) => {
  test.setTimeout(300_000);

  // 归档（走设置页，与既有归档用例一致）。
  await page.goto(`/app/projects/${project.id}/settings`);
  await page.getByRole("button", { name: "归档项目", exact: true }).click();
  await page
    .getByRole("dialog", { name: "归档项目" })
    .getByRole("button", { name: "确认归档", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "恢复项目", exact: true })).toBeVisible();

  // 离开到项目列表默认 tab（未归档）：该项目不应出现。
  await page.goto(`/app/projects`);
  await expect(page.getByRole("heading", { name: "全部项目", exact: true })).toBeVisible();
  await expect(page.getByText(project.name, { exact: true })).toHaveCount(0);

  // 切换「已归档」tab：项目必须能被找回，且带「恢复项目」按钮。
  await page.getByRole("tab", { name: "已归档" }).click();
  await expect(page).toHaveURL(/\?archived=only/);
  const archivedCard = page.getByText(project.name, { exact: true });
  await expect(archivedCard).toBeVisible();
  const restoreButton = page.getByRole("button", { name: "恢复项目", exact: true });
  await expect(restoreButton).toBeVisible();

  // 直接从列表页恢复（不必再跳去设置页）。
  await restoreButton.click();
  await expect(page.getByText(project.name, { exact: true })).toHaveCount(0, { timeout: 10_000 });

  // 切回「未归档」tab：项目重新出现，且已可编辑（不再是只读态）。
  await page.getByRole("tab", { name: "未归档" }).click();
  await expect(page.getByText(project.name, { exact: true })).toBeVisible();

  await page.goto(`/app/projects/${project.id}/settings`);
  await expect(
    page.getByText("项目已归档，处于只读状态。恢复项目后才能编辑资料。", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "归档项目", exact: true })).toBeVisible();
});

/**
 * A10 回归：旧分页响应代次污染（本轮 M4 收尾工作流 2）。
 *
 * 复现路径：点击「加载更多」→ 该请求被人为拦截挂起（模拟慢速网络）→ 在响应尚未落地
 * 期间触发一次后台 refresh（focus 事件，产生新的 initialActivities props 引用，等同于
 * 项目/筛选/刷新代次前移）→ 断言 refresh 已经把新数据带上（新增的探针活动可见）且
 * 「加载更多」的 pending 态已经解除、按钮恢复可点（不能因为旧请求还挂着就永久卡在
 * loading）→ 此时才放行被挂起的旧分页响应 → 断言：
 *  1. 旧响应携带的合成活动（本例故意让它们的 id 在新基线里根本不存在）没有出现在
 *     列表里（不是「被去重」，而是「整批被丢弃，从未进入 state」）；
 *  2. 列表条目数与新首屏保持一致，没有被旧响应追加；
 *  3. 「加载更多」按钮此刻的状态是由新首屏的 hasMore 决定，不是被旧响应的 meta 覆盖
 *     （即没有发生游标/hasMore 回退）；
 *  4. 页面不处于任何异常的持续 pending 态。
 *
 * 与 dedupe-by-id 的区别：本用例故意让旧响应里的活动 id 是全新的（不会与新首屏的 id
 * 撞上），专门证明「按 id 去重」在这种场景下完全无效——必须靠代次绑定在响应落地前
 * 就整批拒收，而不是等它拼进 state 后再试图用去重擦掉。
 */
test("A10：加载更多的旧分页响应在刷新代次前移后落地，必须被整批丢弃，不污染新首屏", async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);

  // 35 条合成活动（连同 PROJECT_CREATED 共 36 条）→ hasMore=true，可点「加载更多」。
  await seedActivities(project.id, ownerUserId, 35);

  await page.goto(`/app/projects/${project.id}/activity`);
  await expect(page.getByRole("heading", { name: "项目活动", exact: true })).toBeVisible();

  const items = page.locator("main ol > li");
  await expect(items).toHaveCount(PAGE_SIZE);

  const loadMore = page.getByRole("button", { name: "加载更多", exact: true });
  await expect(loadMore).toBeVisible();

  // 拦住「加载更多」的分页请求（不含 RSC refresh），先记录真实响应体再挂起，稍后用
  // route.fulfill 原样放行——这样断言 2/3 能核对「旧响应本该带来的 meta」确实被拒收。
  let releaseStale: (() => void) | null = null;
  const staleGate = new Promise<void>((resolve) => {
    releaseStale = resolve;
  });
  let staleRequestSeen = false;
  await page.route(
    (url) => /\/api\/v1\/projects\/[^/]+\/activity\?/.test(url.pathname + "?" + url.search),
    async (route) => {
      staleRequestSeen = true;
      const response = await route.fetch();
      const body = await response.text();
      await staleGate; // 挂起：等测试主体明确放行后才把响应交给页面。
      await route.fulfill({ response, body });
    },
  );

  await loadMore.click();
  await expect.poll(() => staleRequestSeen).toBe(true);

  // 旧请求挂起期间：制造一次会改变首屏活动数量的写操作，再触发 focus 后台刷新——
  // 这一步产生新的 initialActivities props 引用，等同于代次前移。
  const created = await request.post(`/api/v1/projects/${project.id}/tasks`, {
    headers: { origin, "Idempotency-Key": randomUUID() },
    data: { title: "A10 代次探针" },
  });
  expect(created.status()).toBe(201);

  const refreshed = page.waitForResponse(
    (r) =>
      r.url().includes(`/projects/${project.id}/activity`) &&
      r.request().headers()["rsc"] === "1",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;

  // 代次已前移：新首屏应已显示刷新带来的数据。此刻旧的「加载更多」响应仍未放行，
  // 但 pending 态不能被它卡住——按钮必须已经不是 loading（代次不匹配的 finally 分支
  // 会跳过 setLoadingMore(false)，但也不会让它卡在 true：新一轮渲染时 hasMore 由新
  // props 决定，按钮的 disabled 状态只反映当前 loadingMore，而当前代次从未发起过
  // 会把它设为 true 的请求，故它必须保持非 disabled）。
  await expect(loadMore).toBeEnabled();
  await expect(page.getByRole("button", { name: "正在加载…" })).toHaveCount(0);

  const countAfterRefreshBeforeStaleLands = await items.count();

  // 现在放行被挂起的旧响应。
  releaseStale!();
  await page.waitForTimeout(500); // 给旧响应一个足够的时间窗口把自己（错误地）拼进 state。

  // 断言 1+2：条目数没有因为旧响应落地而改变——它被整批丢弃，不是「去重后仍追加了0条
  // 因为id重复」（本例的合成活动id对新基线是全新的，去重不会拦住它们，只有代次校验能）。
  await expect(items).toHaveCount(countAfterRefreshBeforeStaleLands);

  // 断言 3：没有发生游标/hasMore 回退——旧响应的 hasMore 语义已被丢弃，按钮状态仍然
  // 只由当前（刷新后）的首屏 hasMore 决定，而不是被旧响应的 meta 覆盖成别的值。
  // 刷新后的首屏活动数仍然 > 30（新增的任务创建活动排在最前，原 36 条整体后移一位，
  // 仍然超过首屏页大小），故「加载更多」应仍然可见——如果游标被旧响应污染回退，
  // 这里最可能表现为按钮消失或重新点击后请求携带错误的 cursor。
  await expect(loadMore).toBeVisible();

  // 断言 4：页面没有停留在任何异常的持续 pending 态。
  await expect(page.getByRole("button", { name: "正在加载…" })).toHaveCount(0);
});
