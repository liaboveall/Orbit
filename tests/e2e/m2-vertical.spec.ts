import { expect, test, type Cookie, type Response as PwResponse } from "@playwright/test";
import { establishSessionCookies } from "../ui/auth-setup";
import { cleanupTestEmails, withTestDb } from "./support/db";

/**
 * M2 Phase 7 / ORB-009：纵向闭环 E2E（vertical）。
 *
 * 完整浏览器流程验证项目与任务的生命周期（对齐真实 UI，非 DOM ElementHandle）：
 *  1. 建立会话（auth-setup：注册 → Mailpit 验证 → autoSignIn）
 *  2. 导航到 /app/projects（h1「全部项目」）
 *  3. 创建项目（内联表单，非 dialog：填名称/标识/描述 → 提交 → 确认卡片出现）
 *  4. 点击项目卡片进入 /app/projects/[id]/tasks（h1 = 项目名）
 *  5. 创建两个任务（内联表单：填标题 → 提交 → 确认出现在表格）
 *  6. 行内 Select 切换第二个任务状态：待办 → 进行中 → 已完成
 *  7. page.reload() → 断言状态持久化（已完成）
 *  8. 软删除第一个任务（IconButton → 确认 Dialog「删除任务」→「移入回收站」）
 *  9. 导航到 /app/projects/[id]/trash（h1「回收站」）→ 断言被删任务在此
 *  10. 恢复任务（「恢复 <identifier>」按钮）→ 返回任务列表验证复现
 *
 * 运行前置（详见 tests/README.md）：
 *  - 首次需安装浏览器：`pnpm exec playwright install --with-deps chromium`；
 *  - Mailpit 需可达（默认 http://localhost:8025）用于邮箱验证；
 *  - `pnpm test:e2e` 会通过 scripts/e2e-server.mjs 自建连接 orbit_test 的测试服务
 *    （A10 修复：此前直连 DATABASE_URL/orbit_dev）。
 *
 * 数据清理：本用例每轮会创建 User + Project + Task + ActivityLog + IdempotencyRecord。
 * afterAll 经 tests/e2e/support/db.ts 的共享助手（连接**独立测试库** TEST_DATABASE_URL，
 * 已核验与开发库不同名）按 FK 顺序精确删除本轮用唯一 email（ui-<ts>-<rand>@orbit.test）
 * 圈定的数据，不污染开发库、不误删他人数据。
 */

const RUN_TAG = `m2vert-${Date.now()}`;

test.describe("M2 纵向闭环", () => {
  let sessionCookies: Cookie[] = [];
  /** 本轮创建的测试用户 email（唯一），afterAll 据此精确圈定待清理数据。 */
  let testUserEmail = "";

  test.beforeAll(async ({ request }) => {
    // 1. 建立真实会话（走注册 → 邮件验证全流程）。
    //    apiOrigin 必须与浏览器导航的 baseURL 主机一致：session cookie 是 host-only，
    //    主机不匹配则注入后不被 /app/* 认可（会被 proxy 重定向到登录页）。
    //    与 playwright.config.ts 的 baseURL 派生逻辑保持一致（默认 localhost:3100，与
    //    scripts/e2e-server.mjs 的 E2E_PORT 默认值一致，而非开发服务器的 3000）。
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
    // 测试库**（不是开发库）；只删本轮 email 圈定的行，绝不触碰他人数据。失败时抛出
    // 异常而不是吞掉——让用例明确报告清理失败，而不是悄悄留下残留却报告成功。
    if (!testUserEmail) {
      console.warn("[m2-vertical] 跳过清理：缺少测试用户 email。");
      return;
    }
    
    const result = await cleanupTestEmails([testUserEmail]);
    console.log(
      `[m2-vertical] 已清理本轮 E2E 数据：user email=${testUserEmail}，` +
        `清理计数=${JSON.stringify(result.cleanedCount)}${result.error ? ` (${result.error})` : ''}`,
    );
    
    // 日志：显示隔离验证结果
    await withTestDb(async (client) => {
      const devCheck = await client.query('SELECT COUNT(*) FROM "User" WHERE email NOT LIKE $1', ['e2e-%']);
      const testCheck = await client.query('SELECT COUNT(*) FROM "Project"');
      // F33④：此处连接的是 withTestDb 核验过的**测试库**（orbit_test），原日志误标为 dev 库。
      console.log(
        `[isolation] orbit_test 清理后统计：Project=${testCheck.rows[0].count}, ` +
          `测试库剩余用户数（非 e2e 前缀）=${devCheck.rows[0].count}`,
      );
    });
  });

  test("创建项目 → 创建任务 → 编辑状态 → 持久化验证 → 软删除 → 恢复", async ({ page }) => {
    test.setTimeout(300_000);


    // 注入会话 cookie
    await page.context().addCookies(sessionCookies);

    const projectName = `M2 纵向测试项目 ${RUN_TAG}`;
    // Project.key：2—8 位大写字母/数字，首字符为字母（契约 ProjectKeySchema，输入框 maxLength=8）。
    const projectKey = `M2V${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
    const taskTitle1 = "梳理业务流程";
    const taskTitle2 = "实现核心功能";

    // 表格数据行按标题定位（toast 描述也含标题，故一律限定在 tbody/li 内，避免 strict 冲突）。
    const taskRow = (title: string) => page.locator("tbody tr").filter({ hasText: title });

    // 2. 导航到项目列表页
    await page.goto("/app/projects");
    await expect(page.getByRole("heading", { name: "全部项目" })).toBeVisible();

    // 3. 创建新项目：全新用户无项目 → 空态「创建第一个项目」；已有项目 → 页头「新建项目」。
    const createFirst = page.getByRole("button", { name: "创建第一个项目" });
    if ((await createFirst.count()) > 0) {
      await createFirst.click();
    } else {
      await page.getByRole("button", { name: "新建项目" }).click();
    }
    // 内联表单展开（h2「新建项目」，非 dialog）
    await expect(page.getByRole("heading", { name: "新建项目" })).toBeVisible();

    await page.getByLabel("项目名称").fill(projectName);
    await page.getByLabel("项目标识").fill(projectKey);
    await page.getByLabel("项目描述").fill("M2 纵向闭环验证测试项目");
    // 标记色默认 BLUE（合法值），无需交互切换，降低 Radix Select 波动。

    // 提交创建项目：等待 POST /api/v1/projects 返回 201（断言写请求确实成功且被授权）。
    const [projResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/projects",
        { timeout: 20_000 },
      ),
      page.getByRole("button", { name: "创建项目" }).click(),
    ]);
    expect(projResp.status()).toBe(201);

    // reload 触发服务端重读并重新挂载，据此验证项目已持久化（本用例聚焦服务端真源/持久化）。
    // 注：写操作后**同页不 reload** 的即时刷新（含连续写不再假 409）由 m2-no-reload.spec.ts 覆盖。
    await page.reload();
    const projectCard = page.getByRole("main").getByRole("link", { name: projectName });
    await expect(projectCard).toBeVisible();

    // 4. 点击卡片进入项目看板，再切到任务列表
    await projectCard.click();
    await expect(page).toHaveURL(/\/app\/projects\/.+\/board/);
    await page.getByRole("navigation", { name: "项目分区" }).getByRole("link", { name: "列表", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/projects\/.+\/tasks/);
    await expect(page.getByRole("heading", { name: projectName })).toBeVisible();

    // 任务写请求 URL 匹配器（POST 创建 / PATCH 改状态 / DELETE 软删 / POST restore）。
    const isTaskCreate = (r: PwResponse) =>
      r.request().method() === "POST" && /\/api\/v1\/projects\/[^/]+\/tasks$/.test(new URL(r.url()).pathname);
    const isTaskPatch = (r: PwResponse) =>
      r.request().method() === "PATCH" && /^\/api\/v1\/tasks\/[^/]+$/.test(new URL(r.url()).pathname);
    const isTaskDelete = (r: PwResponse) =>
      r.request().method() === "DELETE" && /^\/api\/v1\/tasks\/[^/]+$/.test(new URL(r.url()).pathname);
    const isTaskRestore = (r: PwResponse) =>
      r.request().method() === "POST" && /\/api\/v1\/tasks\/[^/]+\/restore$/.test(new URL(r.url()).pathname);

    // 5. 创建第一个任务（新建任务对话框）
    await page.getByRole("button", { name: "新建任务" }).first().click();
    await expect(page.getByRole("heading", { name: "新建任务" })).toBeVisible();
    await page.getByLabel("任务标题").fill(taskTitle1);
    const [t1Resp] = await Promise.all([
      page.waitForResponse(isTaskCreate, { timeout: 20_000 }),
      page.getByRole("button", { name: "创建任务" }).click(),
    ]);
    expect(t1Resp.status()).toBe(201);
    await page.reload();
    await expect(taskRow(taskTitle1)).toBeVisible();

    // 创建第二个任务
    await page.getByRole("button", { name: "新建任务" }).first().click();
    await expect(page.getByRole("heading", { name: "新建任务" })).toBeVisible();
    await page.getByLabel("任务标题").fill(taskTitle2);
    const [t2Resp] = await Promise.all([
      page.waitForResponse(isTaskCreate, { timeout: 20_000 }),
      page.getByRole("button", { name: "创建任务" }).click(),
    ]);
    expect(t2Resp.status()).toBe(201);
    await page.reload();
    await expect(taskRow(taskTitle2)).toBeVisible();

    // 6. 行内 Select 切换第二个任务状态：待办 → 进行中 → 已完成（每次等待 PATCH 200 后 reload 验证持久化）
    await taskRow(taskTitle2).getByRole("combobox").click();
    const [p1] = await Promise.all([
      page.waitForResponse(isTaskPatch, { timeout: 20_000 }),
      page.getByRole("option", { name: "进行中" }).click(),
    ]);
    expect(p1.status()).toBe(200);
    await page.reload();
    await expect(taskRow(taskTitle2).getByRole("combobox")).toContainText("进行中");

    await taskRow(taskTitle2).getByRole("combobox").click();
    const [p2] = await Promise.all([
      page.waitForResponse(isTaskPatch, { timeout: 20_000 }),
      page.getByRole("option", { name: "已完成" }).click(),
    ]);
    expect(p2.status()).toBe(200);

    // 7. page.reload() 验证持久化：状态仍为「已完成」
    await page.reload();
    await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
    await expect(taskRow(taskTitle2).getByRole("combobox")).toContainText("已完成");

    // 8. 软删除第一个任务：行内 IconButton「删除任务 <id>」→ 确认 Dialog →「移入回收站」
    await taskRow(taskTitle1).getByRole("button", { name: /删除任务/ }).click();
    await expect(page.getByRole("dialog", { name: "删除任务" })).toBeVisible();
    const [delResp] = await Promise.all([
      page.waitForResponse(isTaskDelete, { timeout: 20_000 }),
      page.getByRole("button", { name: "移入回收站" }).click(),
    ]);
    expect(delResp.status()).toBe(200);
    // 删除后 reload：行从未删除列表消失
    await page.reload();
    await expect(taskRow(taskTitle1)).toHaveCount(0);

    // 9. 导航到回收站
    await page.getByRole("link", { name: "回收站" }).click();
    await expect(page).toHaveURL(/\/app\/projects\/.+\/trash/);
    await expect(page.getByRole("heading", { name: "回收站" })).toBeVisible();
    // 被软删除的任务出现在回收站
    const trashItem = page.locator("li").filter({ hasText: taskTitle1 });
    await expect(trashItem).toBeVisible();

    // 10. 恢复任务（按钮文本「恢复 <identifier>」）：等待 POST restore 200 后 reload 验证
    const [resResp] = await Promise.all([
      page.waitForResponse(isTaskRestore, { timeout: 20_000 }),
      trashItem.getByRole("button", { name: /恢复/ }).click(),
    ]);
    expect(resResp.status()).toBe(200);
    await page.reload();
    await expect(page.locator("li").filter({ hasText: taskTitle1 })).toHaveCount(0);

    // 返回任务列表验证任务复现，且第二个任务状态仍持久化为「已完成」
    await page.getByRole("link", { name: "返回任务列表" }).first().click();
    await expect(page).toHaveURL(/\/app\/projects\/.+\/tasks/);
    await expect(taskRow(taskTitle1)).toBeVisible();
    await expect(taskRow(taskTitle2).getByRole("combobox")).toContainText("已完成");
  });
});
