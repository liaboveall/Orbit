import { test, expect } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { establishSessionCookies } from "../ui/auth-setup";
import { cleanupTestEmails, withTestDb } from "./support/db";
import { ProjectSchema, TaskSchema, SuccessResponseSchema, type ProjectDTO, type TaskDTO } from "../../src/contracts";

const origin = process.env.E2E_AUTH_ORIGIN!;
const write = () => ({ origin, "Idempotency-Key": randomUUID() });
let emails: string[] = [], project: ProjectDTO, task: TaskDTO;
test.beforeEach(async ({ request, context, baseURL }) => {
  const meta: { email?: string } = {};
  try { await context.addCookies(await establishSessionCookies(request, baseURL!, meta)); }
  finally { if (meta.email) emails.push(meta.email); }
  const response = await request.post("/api/v1/projects", { headers: write(), data: { name: "九月修复验收", key: "A" + randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase() } });
  expect(response.status()).toBe(201);
  project = SuccessResponseSchema(ProjectSchema).parse(await response.json()).data;
  const created = await request.post(`/api/v1/projects/${project.id}/tasks`, { headers: write(), data: { title: "已有任务" } });
  expect(created.status()).toBe(201);
  task = SuccessResponseSchema(TaskSchema).parse(await created.json()).data;
});
test.afterEach(async ({ page }) => { await page.close(); await cleanupTestEmails(emails); emails = []; });

test("board creation protects collapse and uses product defaults without a false dirty state", async ({ page, request }) => {
  let accept = false, dialogs = 0;
  page.on("dialog", async dialog => { dialogs++; if (accept) await dialog.accept(); else await dialog.dismiss(); });
  await page.goto(`/app/projects/${project.id}/board`);
  const toggle = page.getByRole("button", { name: "新建任务", exact: true });
  const title = page.getByRole("textbox", { name: "任务标题", exact: true });
  const close = page.getByRole("button", { name: "关闭对话框", exact: true });
  await toggle.click(); await close.click();
  await expect(title).toHaveCount(0); expect(dialogs).toBe(0);
  await toggle.click(); await title.fill("保留输入");
  await close.click(); await expect(title).toHaveValue("保留输入"); expect(dialogs).toBe(1);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(title).toHaveValue("保留输入"); expect(dialogs).toBe(2);
  accept = true; await close.click(); await expect(title).toHaveCount(0); expect(dialogs).toBe(3);
  await toggle.click(); await expect(title).toHaveValue(""); await title.fill("默认中优先级");
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  await expect(title).toHaveCount(0); expect(dialogs).toBe(3);
  const result: { data: TaskDTO[] } = await (await request.get(`/api/v1/projects/${project.id}/tasks?q=${encodeURIComponent("默认中优先级")}`)).json();
  expect(result.data).toHaveLength(1); expect(result.data[0]?.priority).toBe("MEDIUM");
  await toggle.click(); await title.fill("明确无优先级");
  await page.getByRole("combobox", { name: "任务优先级" }).click();
  await page.getByRole("option", { name: "无", exact: true }).click();
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  await expect(title).toHaveCount(0);
  const none: { data: TaskDTO[] } = await (await request.get(`/api/v1/projects/${project.id}/tasks?q=${encodeURIComponent("明确无优先级")}`)).json();
  expect(none.data[0]?.priority).toBe("NONE");
});

test("filters apply immediately and survive opening and closing details", async ({ page }) => {
  await page.goto(`/app/projects/${project.id}/board`);
  const search = page.getByRole("searchbox", { name: "搜索任务" });
  const query = () => new URL(page.url()).searchParams.get("q");
  await search.fill(task.identifier);
  await expect.poll(query).toBe(task.identifier);
  await page.locator(`[data-task-link="${task.id}"]`).click();
  await expect(page.getByRole("button", { name: "关闭详情", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await expect(search).toHaveValue(task.identifier);
  await expect.poll(query).toBe(task.identifier);
  await search.fill("不存在的搜索词");
  await search.press("Enter");
  await expect.poll(query).toBe("不存在的搜索词");
  await expect(page.locator(`[data-task-card="${task.id}"]`)).toHaveCount(0);
});

test("sign out cancellation sends no request; failure preserves draft; success confirms only once", async ({ page, request }) => {
  await page.goto("/app/settings");
  await page.locator('input[name="name"]').fill("退出前的草稿");
  let requests = 0, dialogs = 0, accept = false;
  page.on("request", req => { if (req.url().endsWith("/api/auth/sign-out")) requests++; });
  page.on("dialog", async dialog => { dialogs++; if (accept) await dialog.accept(); else await dialog.dismiss(); });
  await page.getByRole("button", { name: "账户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  expect(requests).toBe(0); expect(dialogs).toBe(1);
  expect((await request.get("/api/v1/me")).status()).toBe(200);
  accept = true;
  await page.route("**/api/auth/sign-out", route => route.abort("failed"));
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await expect(page.getByText("退出失败", { exact: true })).toBeVisible();
  await expect(page.locator('input[name="name"]')).toHaveValue("退出前的草稿");
  expect(dialogs).toBe(2);
  await page.unroute("**/api/auth/sign-out");
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  expect(requests).toBe(2); expect(dialogs).toBe(3);
  expect((await request.get("/api/v1/me")).status()).toBe(401);
});

test("live board shows collaboration counts and refreshes them, including narrow layouts", async ({ page, request }) => {
  const sub = await request.post(`/api/v1/tasks/${task.id}/subtasks`, { headers: write(), data: { title: "子任务" } });
  expect(sub.status()).toBe(201);
  const child: { data: { id: string; version: number } } = await sub.json();
  expect((await request.patch(`/api/v1/subtasks/${child.data.id}`, { headers: { origin }, data: { expectedVersion: child.data.version, isCompleted: true } })).status()).toBe(200);
  expect((await request.post(`/api/v1/tasks/${task.id}/comments`, { headers: write(), data: { body: "可见讨论" } })).status()).toBe(201);
  const bytes = Buffer.from("board count fixture");
  expect((await request.post(`/api/v1/tasks/${task.id}/attachments`, { headers: { origin }, multipart: {
    uploadId: randomUUID(), declaredSizeBytes: String(bytes.length), sha256: createHash("sha256").update(bytes).digest("hex"), file: { name: "count.txt", mimeType: "text/plain", buffer: bytes },
  } })).status()).toBe(201);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/projects/${project.id}/board`);
  const card = page.locator(`[data-task-card="${task.id}"]`);
  for (const text of ["子任务 1/1", "评论 1", "附件 1"]) await expect(card.getByText(text, { exact: true })).toBeVisible();
  expect((await request.post(`/api/v1/tasks/${task.id}/comments`, { headers: write(), data: { body: "新增讨论" } })).status()).toBe(201);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(card.getByText("评论 2", { exact: true })).toBeVisible();
});

test("quota guidance offers an effective action and deleting an active task actually releases capacity", async ({ page, request }) => {
  await withTestDb(async db => {
    await db.query('INSERT INTO "Task" (id,"projectId",number,"creatorId",title,position,"updatedAt") SELECT gen_random_uuid(),$1::uuid,n,$2,\'配额夹具\',n*1024,NOW() FROM generate_series(2,1000) n', [project.id, task.creator.id]);
    await db.query('UPDATE "Project" SET "nextTaskNumber"=1001 WHERE id=$1::uuid', [project.id]);
  });
  await page.goto(`/app/projects/${project.id}/board`);
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await page.getByRole("textbox", { name: "任务标题", exact: true }).fill("额度恢复后创建");
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  await expect(page.getByText("未删除任务已达上限（1000 个），请删除不再需要的任务，或联系项目所有者处理。", { exact: true })).toBeVisible();
  expect((await request.delete(`/api/v1/tasks/${task.id}?expectedVersion=${task.version}`, { headers: { origin } })).status()).toBe(200);
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "任务标题", exact: true })).toHaveCount(0);
});

test("task deletion rejects ambiguous version text and comments report Chinese field validation", async ({ request }) => {
  for (const query of ["expectedVersion=1e0", "expectedVersion=0x1", "expectedVersion=1&expectedVersion=1", "expectedVersion=9007199254740992"]) {
    const response = await request.delete(`/api/v1/tasks/${task.id}?${query}`, { headers: { origin } });
    expect(response.status()).toBe(400);
    const body = await response.json(); expect(body.error.fieldErrors.expectedVersion).toBeDefined();
  }
  expect((await request.get(`/api/v1/tasks/${task.id}`)).status()).toBe(200);
  const comments = await request.get(`/api/v1/tasks/${task.id}/comments?limit=0`);
  expect(comments.status()).toBe(400);
  const body = await comments.json();
  expect(body.error.message).toBe("请求校验未通过，请检查输入后重试。");
  expect(body.error.fieldErrors.limit).toBeDefined();
});

test("HTTP write quota returns Retry-After and recovers after the actual minute window", async ({ request }) => {
  test.setTimeout(90_000);
  let retryAfter = 0;
  for (let i = 0; i < 61; i++) {
    const response = await request.delete(`/api/v1/tasks/${task.id}?expectedVersion=invalid`, { headers: { origin } });
    if (response.status() === 429) {
      retryAfter = Number(response.headers()["retry-after"]);
      expect((await response.json()).error.code).toBe("RATE_LIMITED");
      break;
    }
    expect(response.status()).toBe(400);
  }
  expect(retryAfter).toBeGreaterThan(0); expect(retryAfter).toBeLessThanOrEqual(60);
  await new Promise(resolve => setTimeout(resolve, retryAfter * 1000 + 100));
  const recovered = await request.delete(`/api/v1/tasks/${task.id}?expectedVersion=invalid`, { headers: { origin } });
  expect(recovered.status()).toBe(400);
  expect((await recovered.json()).error.code).toBe("VALIDATION_ERROR");
  expect((await request.get(`/api/v1/tasks/${task.id}`)).status()).toBe(200);
});
