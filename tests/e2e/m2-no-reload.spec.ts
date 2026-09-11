import { expect, test, type Cookie, type Page, type Response as PwResponse } from "@playwright/test";
import { establishSessionCookies } from "../ui/auth-setup";
import { cleanupTestEmails } from "./support/db";

/**
 * M2 / Task #33：**不 reload** 的连续写操作回归（专门捕获「props→useState 镜像」缺陷）。
 *
 * 背景缺陷：project-list-client / task-list-client 曾用 `useState(initialProps)` 镜像
 * Server Component 首屏 props，写操作成功后只调 `router.refresh()`；组件不重挂载 →
 * useState 不以新 props 重新初始化 → 列表/行内 Select/task.version 全部停在旧值。
 * 用户可见后果：① 创建后同页「什么都没发生」；② 改状态无反馈；③ 因 expectedVersion
 * 陈旧，同一次页面停留内的第二次写操作必然假 409 VERSION_CONFLICT；④ 删除后行不消失。
 *
 * 修复原则：props 是唯一数据真源，Transition 跟踪刷新完成，新的 props 提交后才恢复交互。
 *
 * 与 m2-vertical.spec.ts 的区别：vertical 每步都 page.reload()（验证持久化），恰好绕过了
 * 本缺陷的真实交互路径。本用例**全程不 reload**，断言每次写操作后同页 UI 立即更新，
 * 且核心步骤「连续两次改状态」返回 200 而非假 409。
 *
 * 运行前置：`pnpm test:e2e` 会通过 scripts/e2e-server.mjs 自建连接 orbit_test 的测试
 * 服务（A10 修复：此前直连 DATABASE_URL/orbit_dev），首次装浏览器、Mailpit 可达。
 * 数据清理：afterAll 经 tests/e2e/support/db.ts 的共享助手（连接已核验的独立测试库）
 * 按本轮唯一 email 精确圈定删除，不污染开发库。
 */

const RUN_TAG = `m2nr-${Date.now()}`;

/** 只延迟 RSC 刷新，让测试覆盖 API 已成功而新 props 尚未到达的窗口。 */
async function holdRefresh(page: Page) {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  const active = new Set<Promise<void>>();
  const handler = (route: import("@playwright/test").Route) => {
    const work = (async () => {
      if (route.request().headers()["rsc"] === "1") { held = true; await gate; }
      await route.fallback();
    })();
    active.add(work);
    void work.then(() => active.delete(work), () => active.delete(work));
    return work;
  };
  await page.route("**/*", handler);
  return { held: () => held, release, dispose: async () => {
    release();
    while (active.size) await Promise.all([...active]);
    await page.unroute("**/*", handler);
  } };
}

test.describe("M2 不 reload 连续写（假 409 回归）", () => {
  let sessionCookies: Cookie[] = [];
  let testUserEmail = "";

  test.beforeAll(async ({ request }) => {
    // 建立真实会话（注册 → Mailpit 验证 → autoSignIn）。apiOrigin 须与浏览器 baseURL 同源，
    // 否则 host-only 的 session cookie 注入后不被 /app/* 认可（详见 m2-vertical 注释）。
    // 默认端口 3100（scripts/e2e-server.mjs 的 E2E_PORT 默认值），与开发服务器的 3000 分开。
    const apiOrigin =
      process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
    const meta: { email?: string } = {};
    sessionCookies = await establishSessionCookies(request, apiOrigin, meta);
    testUserEmail = meta.email ?? "";
    expect(sessionCookies.length).toBeGreaterThan(0);
    expect(sessionCookies.some((c) => /session_token/.test(c.name))).toBe(true);
  });

  test.afterAll(async () => {
    // 按 FK onDelete:Restrict 顺序清理本轮数据（子→父），经共享助手连接**已核验的独立
    // 测试库**（不是开发库）；只删本轮 email 圈定的行。失败时抛出异常而不是吞掉。
    if (!testUserEmail) {
      console.warn("[m2-no-reload] 跳过清理：缺少测试用户 email。");
      return;
    }
    await cleanupTestEmails([testUserEmail]);
    console.log(`[m2-no-reload] 已清理本轮 E2E 数据：user email=${testUserEmail}。`);
  });

  test("创建项目 → 创建任务 → 连续改状态两次（无假 409）→ 删除 → 恢复（全程不 reload）", async ({
    page,
  }) => {
    test.setTimeout(300_000);

    await page.context().addCookies(sessionCookies);

    const projectName = `M2 无刷新测试项目 ${RUN_TAG}`;
    // Project.key：2—8 位大写字母/数字，首字符为字母（契约 ProjectKeySchema，输入框 maxLength=8）。
    const projectKey = `NR${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
    const taskTitle = "无刷新连续写任务";

    // 表格数据行按标题定位（toast 描述也含标题，故限定在 tbody 内避免 strict 冲突）。
    const taskRow = page.locator("tbody tr").filter({ hasText: taskTitle });

    // 任务写请求 URL 匹配器。
    const isTaskCreate = (r: PwResponse) =>
      r.request().method() === "POST" &&
      /\/api\/v1\/projects\/[^/]+\/tasks$/.test(new URL(r.url()).pathname);
    const isTaskPatch = (r: PwResponse) =>
      r.request().method() === "PATCH" &&
      /^\/api\/v1\/tasks\/[^/]+$/.test(new URL(r.url()).pathname);
    const isTaskDelete = (r: PwResponse) =>
      r.request().method() === "DELETE" &&
      /^\/api\/v1\/tasks\/[^/]+$/.test(new URL(r.url()).pathname);
    const isTaskRestore = (r: PwResponse) =>
      r.request().method() === "POST" &&
      /\/api\/v1\/tasks\/[^/]+\/restore$/.test(new URL(r.url()).pathname);

    // ── 步骤 1：创建项目（不 reload，断言卡片同页立即出现）─────────────────────
    await page.goto("/app/projects");
    await expect(page.getByRole("heading", { name: "全部项目" })).toBeVisible();

    const createFirst = page.getByRole("button", { name: "创建第一个项目" });
    if ((await createFirst.count()) > 0) {
      await createFirst.click();
    } else {
      await page.getByRole("button", { name: "新建项目" }).click();
    }
    await expect(page.getByRole("heading", { name: "新建项目" })).toBeVisible();
    await page.getByLabel("项目名称").fill(projectName);
    await page.getByLabel("项目标识").fill(projectKey);
    await page.getByLabel("项目描述").fill("M2 不 reload 连续写回归项目");

    const [projResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/projects",
        { timeout: 20_000 },
      ),
      page.getByRole("button", { name: "创建项目" }).click(),
    ]);
    expect(projResp.status()).toBe(201);

    // 关键：**不 reload**，断言新项目卡片经 router.refresh() 后同页立即出现。
    const projectCard = page.getByRole("button", { name: projectName });
    await expect(projectCard).toBeVisible();

    // ── 步骤 2：进入任务页 → 创建任务（不 reload，断言行同页立即出现）────────────
    await projectCard.click();
    await expect(page).toHaveURL(/\/app\/projects\/.+\/tasks/);
    await expect(page.getByRole("heading", { name: projectName })).toBeVisible();

    await page.getByRole("button", { name: "新建任务" }).first().click();
    await expect(page.getByRole("heading", { name: "新建任务" })).toBeVisible();
    await page.getByLabel("任务标题").fill(taskTitle);
    const [createResp] = await Promise.all([
      page.waitForResponse(isTaskCreate, { timeout: 20_000 }),
      page.getByRole("button", { name: "创建任务" }).click(),
    ]);
    expect(createResp.status()).toBe(201);

    // 关键：**不 reload**，断言任务行经 refresh 后同页立即出现，初始状态「待办」。
    await expect(taskRow).toBeVisible();
    await expect(taskRow.getByRole("combobox")).toContainText("待办");

    // ── 步骤 3：改状态 → 进行中（不 reload，断言 Select 同页显示「进行中」）──────
    const combobox = taskRow.getByRole("combobox");
    const delayed = await holdRefresh(page);
    try {
      await combobox.click();
      const [patch1] = await Promise.all([
        page.waitForResponse(isTaskPatch, { timeout: 20_000 }),
        page.getByRole("option", { name: "进行中" }).click(),
      ]);
      expect(patch1.status()).toBe(200);
      await expect.poll(delayed.held).toBe(true);
      // 在旧 version 窗口，状态与删除入口共用同一个待完成状态。
      await expect(combobox).toBeDisabled();
      await expect(taskRow.getByRole("button", { name: /删除任务/ })).toBeDisabled();
      await page.screenshot({ path: "artifacts/m2-fix-delayed-refresh.png", fullPage: true });
    } finally { delayed.release(); await delayed.dispose(); }
    await expect(combobox).toContainText("进行中");
    await expect(combobox).toBeEnabled();

    // ── 步骤 4（核心）：紧接着再改 → 已完成（不 reload，断言 200 而非假 409）──────
    // 若 task.version 仍陈旧（镜像缺陷），此处必返回 409 VERSION_CONFLICT。
    await combobox.click();
    const [patch2] = await Promise.all([
      page.waitForResponse(isTaskPatch, { timeout: 20_000 }),
      page.getByRole("option", { name: "已完成" }).click(),
    ]);
    expect(patch2.status()).toBe(200); // ← 捕获假 409 的关键断言
    await expect(combobox).toContainText("已完成");

    // ── 步骤 5：删除任务（不 reload，断言行同页消失）────────────────────────────
    await taskRow.getByRole("button", { name: /删除任务/ }).click();
    await expect(page.getByRole("dialog", { name: "删除任务" })).toBeVisible();
    const [delResp] = await Promise.all([
      page.waitForResponse(isTaskDelete, { timeout: 20_000 }),
      page.getByRole("button", { name: "移入回收站" }).click(),
    ]);
    expect(delResp.status()).toBe(200);
    // 关键：**不 reload**，断言已删行经 refresh 后同页消失。
    await expect(taskRow).toHaveCount(0);

    // ── 步骤 6：回收站恢复（不 reload，断言同页更新）────────────────────────────
    await page.getByRole("link", { name: "回收站" }).click();
    await expect(page).toHaveURL(/\/app\/projects\/.+\/trash/);
    await expect(page.getByRole("heading", { name: "回收站" })).toBeVisible();
    // 回收站行按标题定位，并要求其内含「恢复」按钮：**不 reload** 时创建/删除的 success
    // toast 也以 <li> 呈现且描述含任务标题，仅按 hasText 会与 toast 撞 strict mode；
    // 叠加「含恢复按钮」条件可精确锁定回收站列表项（toast 无此按钮）。
    const trashItem = page
      .locator("li")
      .filter({ hasText: taskTitle })
      .filter({ has: page.getByRole("button", { name: /恢复/ }) });
    await expect(trashItem).toBeVisible();

    // 服务端已恢复但响应在传输中丢失：原页面重试必须复用同一个 key 和 body。
    const attempts: { key: string | undefined; body: unknown }[] = [];
    await page.route("**/api/v1/tasks/*/restore", async route => {
      attempts.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() });
      if (attempts.length === 1) {
        const committed = await route.fetch();
        expect(committed.status()).toBe(200);
        await route.abort("failed");
      } else { await route.continue(); }
    });
    await trashItem.getByRole("button", { name: /恢复/ }).click();
    await expect(trashItem.getByText("无法连接服务器，请检查网络后重试。")).toBeVisible();
    const restoreRefresh = await holdRefresh(page);
    try {
      const [restoreResp] = await Promise.all([
        page.waitForResponse(isTaskRestore, { timeout: 20_000 }),
        trashItem.getByRole("button", { name: /恢复/ }).click(),
      ]);
      expect(restoreResp.status()).toBe(200);
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toEqual(attempts[0]);
      await expect.poll(restoreRefresh.held).toBe(true);
      await expect(trashItem.getByRole("button", { name: /恢复/ })).toBeDisabled();
    } finally { restoreRefresh.release(); await restoreRefresh.dispose(); }
    await expect(trashItem).toHaveCount(0);
  });

  test("真实任务页和逾期 API 都使用账户时区", async ({ page }) => {
    await page.context().addCookies(sessionCookies);
    const origin =
      process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
    const api = page.request;
    const zone = new Date().getUTCHours() < 10 ? "Pacific/Honolulu" : "Pacific/Kiritimati";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    expect(today).not.toBe(new Date().toISOString().slice(0, 10));
    expect((await api.patch(`${origin}/api/v1/me`, { headers: { origin }, data: { timezone: zone } })).status()).toBe(200);
    const created = await api.post(`${origin}/api/v1/projects`, { headers: { origin, "Idempotency-Key": crypto.randomUUID() }, data: { name: "账户时区回归", key: `TZ${crypto.randomUUID().replaceAll("-", "").slice(0, 6)}`.toUpperCase() } });
    expect(created.status()).toBe(201);
    const project = (await created.json()).data;
    const task = await api.post(`${origin}/api/v1/projects/${project.id}/tasks`, { headers: { origin, "Idempotency-Key": crypto.randomUUID() }, data: { title: "用户今天截止", dueDate: today } });
    expect(task.status()).toBe(201);
    const overdue = await api.get(`${origin}/api/v1/projects/${project.id}/tasks?overdue=true`);
    expect(overdue.status()).toBe(200);
    expect((await overdue.json()).data).toEqual([]);
    await page.goto(`${origin}/app/projects/${project.id}/tasks`);
    const row = page.getByRole("row").filter({ hasText: "用户今天截止" });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText("逾期");
    await page.screenshot({ path: "artifacts/m2-fix-user-timezone.png", fullPage: true });
  });
});
