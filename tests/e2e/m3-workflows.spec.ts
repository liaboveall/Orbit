import {
  test,
  expect,
  type APIRequestContext,
  type Cookie,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import pg from "pg";
import {
  ProjectSchema,
  TaskSchema,
  SuccessResponseSchema,
  type ProjectDTO,
} from "../../src/contracts";
import { establishSessionCookies } from "../ui/auth-setup";

dotenv.config({ path: [".env.local", ".env"], quiet: true });
test.describe.configure({ mode: "serial" });
let project: ProjectDTO;
let userId = "";
let email = "";
let cookies: Cookie[] = [];
const origin = process.env.E2E_AUTH_ORIGIN ?? "http://localhost:3000";
async function db<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const target = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(target.hostname) ||
    target.pathname !== "/orbit_dev"
  )
    throw new Error("M3 browser tests require the local development database");
  const client = new pg.Client({ connectionString: target.href });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}
async function task(request: APIRequestContext, title: string) {
  const res = await request.post(`/api/v1/projects/${project.id}/tasks`, {
    headers: { origin, "Idempotency-Key": randomUUID() },
    data: { title },
  });
  expect(res.status()).toBe(201);
  return SuccessResponseSchema(TaskSchema).parse(await res.json()).data;
}
async function saved(request: APIRequestContext, id: string) {
  const res = await request.get(`/api/v1/tasks/${id}`);
  expect(res.status()).toBe(200);
  return SuccessResponseSchema(TaskSchema).parse(await res.json()).data;
}
test.beforeEach(async ({ request, context, baseURL }) => {
  const meta: { email?: string } = {};
  cookies = await establishSessionCookies(request, baseURL!, meta);
  email = meta.email!;
  await context.addCookies(cookies);
  const me = await request.get("/api/v1/me");
  userId = (await me.json()).data.id;
  const res = await request.post("/api/v1/projects", {
    headers: { origin, "Idempotency-Key": randomUUID() },
    data: {
      name: "M3 实际流程",
      key: "M" + randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase(),
    },
  });
  expect(res.status()).toBe(201);
  project = SuccessResponseSchema(ProjectSchema).parse(await res.json()).data;
});
test.afterEach(async () => {
  if (!email) return;
  await db(async (client) => {
    const users = await client.query('SELECT id FROM "User" WHERE email=$1', [
      email,
    ]);
    const ids = users.rows.map((r: { id: string }) => r.id);
    const projects = await client.query(
      'SELECT id FROM "Project" WHERE "ownerId"=ANY($1::text[])',
      [ids],
    );
    const pids = projects.rows.map((r: { id: string }) => r.id);
    await client.query(
      'DELETE FROM "ActivityLog" WHERE "projectId"=ANY($1::uuid[])',
      [pids],
    );
    await client.query(
      'DELETE FROM "IdempotencyRecord" WHERE "userId"=ANY($1::text[])',
      [ids],
    );
    await client.query('DELETE FROM "Task" WHERE "projectId"=ANY($1::uuid[])', [
      pids,
    ]);
    await client.query(
      'DELETE FROM "ProjectMember" WHERE "projectId"=ANY($1::uuid[])',
      [pids],
    );
    await client.query('DELETE FROM "Project" WHERE id=ANY($1::uuid[])', [
      pids,
    ]);
    await client.query('DELETE FROM "User" WHERE id=ANY($1::text[])', [ids]);
  });
  email = "";
});

test("390px: list → panel, exact draft recovery, persistent edits, URL filters and deletion", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const t = await task(request, "手机任务");
  await page.goto(`/app/projects/${project.id}/tasks`);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("link", { name: t.title, exact: true }).click();
  await page.getByRole("button", { name: t.title, exact: true }).click();
  const input = page.getByRole("textbox", { name: "编辑标题", exact: true });
  await input.fill("草稿 ABC");
  await input.press("End");
  await input.pressSequentially("!");
  await page.reload();
  await page.getByRole("button", { name: t.title, exact: true }).click();
  await expect(input).toHaveValue("草稿 ABC!");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(input).toHaveCount(0);
  expect((await saved(request, t.id)).title).toBe("草稿 ABC!");
  await page
    .getByRole("combobox", { name: "状态", exact: true })
    .selectOption("IN_PROGRESS");
  await expect
    .poll(async () => (await saved(request, t.id)).status)
    .toBe("IN_PROGRESS");
  await page
    .getByRole("combobox", { name: "优先级", exact: true })
    .selectOption("HIGH");
  await expect
    .poll(async () => (await saved(request, t.id)).priority)
    .toBe("HIGH");
  await page.screenshot({
    path: test.info().outputPath("mobile-real-detail.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await expect(page).not.toHaveURL(/task=/);
  await page.getByRole("searchbox", { name: "搜索任务" }).fill(t.identifier);
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(page).toHaveURL(/q=/);
  await page.reload();
  await expect(
    page.getByRole("link", { name: "草稿 ABC!", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "草稿 ABC!", exact: true }).click();
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "删除任务", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page).not.toHaveURL(/task=/);
  expect((await request.get(`/api/v1/tasks/${t.id}`)).status()).toBe(404);
});

test("two browser editors: network retries release pending and 409 preserves the complete draft", async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  const t = await task(request, "冲突任务");
  await page.goto(`/app/projects/${project.id}/tasks/${t.id}`);
  await page.getByRole("button", { name: t.title, exact: true }).click();
  const input = page.getByRole("textbox", { name: "编辑标题", exact: true });
  await input.fill("我的完整草稿!");
  await page.route(`**/api/v1/tasks/${t.id}`, (route) =>
    route.request().method() === "PATCH"
      ? route.abort("internetdisconnected")
      : route.continue(),
  );
  for (let n = 0; n < 2; n++) {
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      page.getByText("无法连接服务器，输入已保留，请重试。", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "保存", exact: true }),
    ).toBeEnabled();
  }
  await page.unroute(`**/api/v1/tasks/${t.id}`);
  const other = await browser.newContext();
  await other.addCookies(cookies);
  try {
    const second = await other.newPage();
    await second.goto(baseURL + `/app/projects/${project.id}/tasks/${t.id}`);
    await second.getByRole("button", { name: t.title, exact: true }).click();
    await second
      .getByRole("textbox", { name: "编辑标题", exact: true })
      .fill("另一窗口的更新");
    await second.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      second.getByRole("textbox", { name: "编辑标题", exact: true }),
    ).toHaveCount(0);
  } finally {
    await other.close();
  }
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(input).toHaveValue("我的完整草稿!");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "载入最新版本并保留草稿", exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("我的完整草稿!");
  await page
    .getByRole("button", { name: "载入最新版本并保留草稿", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(input).toHaveCount(0);
  expect((await saved(request, t.id)).title).toBe("我的完整草稿!");
  expect((await saved(request, t.id)).version).toBe(3);
});

async function dragToColumn(
  page: Page,
  identifier: string,
  statusLabel: string,
) {
  const handle = page.getByRole("button", {
    name: "排序 " + identifier,
    exact: true,
  });
  await handle.scrollIntoViewIfNeeded();
  const from = await handle.boundingBox();
  const target = page.getByRole("region", {
    name: statusLabel + "列",
    exact: true,
  });
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("Drag targets not visible");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 15, from.y + 15, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 20, {
    steps: 12,
  });
  await page.mouse.up();
}
test("real drag persists, network failure rolls back, and keyboard status alternative works", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const a = await task(request, "拖动 A");
  const b = await task(request, "拖动 B");
  await page.goto(`/app/projects/${project.id}/board`);
  await expect(page.getByText("M0 布局样例", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("M0 样例六态切换", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("desktop-real-board.png"),
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "排序 " + a.identifier, exact: true }),
  ).toBeEnabled();
  await dragToColumn(page, a.identifier, "已完成");
  await expect
    .poll(async () => (await saved(request, a.id)).status)
    .toBe("DONE");
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "已完成列", exact: true })
      .getByRole("link", { name: a.title, exact: true }),
  ).toBeVisible();
  await page.route(`**/api/v1/tasks/${b.id}/move`, (route) =>
    route.abort("internetdisconnected"),
  );
  await dragToColumn(page, b.identifier, "进行中");
  await expect(
    page
      .getByRole("region", { name: "待办列", exact: true })
      .getByRole("link", { name: b.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "移动 " + b.identifier, exact: true }),
  ).toBeEnabled();
  expect((await saved(request, b.id)).status).toBe("TODO");
  await page.unroute(`**/api/v1/tasks/${b.id}/move`);
  const select = page.getByRole("combobox", {
    name: "移动 " + b.identifier,
    exact: true,
  });
  await select.focus();
  await select.press("ArrowDown");
  await select.press("Enter");
  await expect
    .poll(async () => (await saved(request, b.id)).status)
    .toBe("IN_PROGRESS");
});

test("list discards a delayed page after a mutation refresh", async ({
  page,
  request,
}) => {
  await seed(51);
  await page.goto(`/app/projects/${project.id}/tasks`);
  await expect(page.getByRole("row")).toHaveCount(51);
  let release = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let held = false;
  await page.route(
    `**/api/v1/projects/${project.id}/tasks?**`,
    async (route) => {
      const response = await route.fetch();
      held = true;
      await gate;
      await route.fulfill({ response }).catch(() => {});
    },
  );
  try {
    await page.getByRole("button", { name: "加载更多", exact: true }).click();
    await expect.poll(() => held).toBe(true);
    const oldest = await db(
      async (client) =>
        (
          await client.query(
            'SELECT id FROM "Task" WHERE "projectId"=$1 AND number=1',
            [project.id],
          )
        ).rows[0] as { id: string },
    );
    const changed = await request.patch(`/api/v1/tasks/${oldest.id}`, {
      headers: { origin },
      data: { expectedVersion: 1, status: "IN_PROGRESS" },
    });
    expect(changed.status()).toBe(200);
    await page
      .getByRole("row")
      .filter({ hasText: "分页 051" })
      .getByRole("combobox")
      .click();
    await page.getByRole("option", { name: "进行中", exact: true }).click();
    const row = page.getByRole("row").filter({ hasText: "分页 001" });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("combobox")).toHaveText("进行中");
    release();
    await page.waitForTimeout(300);
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("combobox")).toHaveText("进行中");
  } finally {
    release();
  }
});

async function seed(count: number) {
  await db(async (client) => {
    await client.query(
      `INSERT INTO "Task" (id,"projectId",number,"creatorId",title,position,"createdAt","updatedAt") SELECT gen_random_uuid(),$1::uuid,n,$2,'分页 '||lpad(n::text,3,'0'),n*1024,now()-interval '1 day',now()-interval '1 day'+n*interval '1 second' FROM generate_series(1,$3::int) n`,
      [project.id, userId, count],
    );
    await client.query(
      'UPDATE "Project" SET "nextTaskNumber"=$1,"boardVersion"="boardVersion"+1 WHERE id=$2',
      [count + 1, project.id],
    );
  });
}

test("1000 real tasks: paged board, stale snapshot recovery and complete-view sorting gate", async ({
  page,
  request,
}, info) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seed(1000);
  const start = Date.now();
  await page.goto(`/app/projects/${project.id}/board`);
  await expect(page.locator("[data-task-card]")).toHaveCount(50);
  await expect(
    page.getByRole("button", { name: /^排序 / }).first(),
  ).toBeDisabled();
  const firstId = await page
    .locator("[data-task-card]")
    .first()
    .getAttribute("data-task-card");
  const old = await saved(request, firstId!);
  const changed = await request.patch(`/api/v1/tasks/${old.id}`, {
    headers: { origin },
    data: { expectedVersion: old.version, status: "IN_PROGRESS" },
  });
  expect(changed.status()).toBe(200);
  await page
    .getByRole("button", { name: "加载更多（待办）", exact: true })
    .click();
  await expect(
    page.getByText("看板已更新，已重新加载，请继续操作。", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "加载全部后排序", exact: true })
    .click();
  await expect(page.locator("[data-task-card]")).toHaveCount(1000, {
    timeout: 60000,
  });
  await expect(
    page.getByRole("button", { name: /^排序 / }).first(),
  ).toBeEnabled();
  await info.attach("1000-task-development-measurement", {
    body: JSON.stringify({
      tasks: 1000,
      initialCards: 50,
      loadedCards: 1000,
      elapsedMs: Date.now() - start,
      environment: "local development; not production benchmark",
    }),
    contentType: "application/json",
  });
  await page
    .getByRole("searchbox", { name: "搜索任务", exact: true })
    .fill("分页 001");
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(page.locator("[data-task-card]")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /^排序 / }).first(),
  ).toBeDisabled();
});

test("keyboard panel protects drafts, restores focus and refreshes on focus", async ({
  page,
  request,
}) => {
  const t = await task(request, "键盘任务");
  await page.goto(`/app/projects/${project.id}/tasks`);
  const link = page.getByRole("link", { name: t.title, exact: true });
  await link.focus();
  await link.press("Enter");
  await page.getByRole("button", { name: t.title, exact: true }).click();
  const input = page.getByRole("textbox", { name: "编辑标题", exact: true });
  await input.fill("保留我的输入");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "你有未保存的更改", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保留编辑", exact: true }).click();
  await expect(input).toHaveValue("保留我的输入");
  await page.clock.install();
  await page.clock.fastForward(31000);
  await expect(input).toHaveValue("保留我的输入");
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.getByRole("button", { name: "放弃更改", exact: true }).click();
  await expect(page).not.toHaveURL(/task=/);
  await expect(link).toBeFocused();
  const response = await request.patch(`/api/v1/tasks/${t.id}`, {
    headers: { origin },
    data: { expectedVersion: 1, title: "远端已更新" },
  });
  expect(response.status()).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("link", { name: "远端已更新", exact: true }),
  ).toBeVisible();
});
