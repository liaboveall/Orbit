import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { establishSessionCookies } from "../ui/auth-setup";
import { cleanupTestEmails } from "./support/db";
import { ProjectSchema, TaskSchema, SuccessResponseSchema, type ProjectDTO, type TaskDTO } from "../../src/contracts";

/**
 * 草稿生命周期与「任务在别处被删除」回归（DRAFT-LOGOUT、隐藏草稿提交、DRAFT-HISTORY、
 * 删除后整页 404）。全部使用本轮合成账号与项目，结束后精确清理。
 */

const origin = process.env.E2E_AUTH_ORIGIN!;
const write = () => ({ origin, "Idempotency-Key": randomUUID() });
let emails: string[] = [], project: ProjectDTO, task: TaskDTO;
test.beforeEach(async ({ request, context, baseURL }) => {
  const meta: { email?: string } = {};
  try { await context.addCookies(await establishSessionCookies(request, baseURL!, meta)); }
  finally { if (meta.email) emails.push(meta.email); }
  const response = await request.post("/api/v1/projects", { headers: write(), data: { name: "草稿与删除回归", key: "D" + randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase() } });
  expect(response.status()).toBe(201);
  project = SuccessResponseSchema(ProjectSchema).parse(await response.json()).data;
  const created = await request.post(`/api/v1/projects/${project.id}/tasks`, { headers: write(), data: { title: "草稿回归任务" } });
  expect(created.status()).toBe(201);
  task = SuccessResponseSchema(TaskSchema).parse(await created.json()).data;
});
test.afterEach(async ({ page }) => { await page.close(); await cleanupTestEmails(emails); emails = []; });

const draftKey = () => `orbit:draft:${task.creator.id}:${project.id}:${task.id}`;
const storedDraft = (page: Page) => page.evaluate((key) => localStorage.getItem(key), draftKey());
const savedTask = async (page: Page) =>
  SuccessResponseSchema(TaskSchema).parse(await (await page.request.get(`/api/v1/tasks/${task.id}`)).json()).data;
const deleteElsewhere = async (page: Page) =>
  expect((await page.request.delete(`/api/v1/tasks/${task.id}?expectedVersion=${task.version}`, { headers: { origin } })).status()).toBe(200);

test("confirmed leave discards the stored description draft; a later title-only edit saves only the title", async ({ page }) => {
  await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
  await page.getByRole("button", { name: "编辑描述", exact: true }).click();
  await page.getByRole("textbox", { name: "编辑描述", exact: true }).fill("已确认放弃的草稿");
  await expect.poll(() => storedDraft(page)).not.toBeNull();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("link", { name: "返回看板" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/projects/${project.id}/board`));
  expect(await storedDraft(page)).toBeNull();

  await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
  await expect(page.getByRole("status").filter({ hasText: "本机保存了未提交的" })).toHaveCount(0);
  await page.getByRole("button", { name: task.title, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "编辑描述", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "编辑标题", exact: true }).fill("只修改标题");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "只修改标题", exact: true })).toBeVisible();
  expect(await savedTask(page)).toMatchObject({ title: "只修改标题", description: "" });
});

test("reload keeps a recoverable draft: every drafted field is visible before saving, and the draft can be deleted", async ({ page }) => {
  const notice = page.getByRole("status").filter({ hasText: "本机保存了未提交的描述草稿" });
  const description = page.getByRole("textbox", { name: "编辑描述", exact: true });
  await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
  await page.getByRole("button", { name: "编辑描述", exact: true }).click();
  await description.fill("刷新后恢复的描述");
  await page.reload();
  await expect(notice).toBeVisible();
  // 从标题进入编辑也会把描述草稿一并展示出来：不存在「看不见却会被提交」的字段。
  await page.getByRole("button", { name: task.title, exact: true }).click();
  await expect(description).toHaveValue("刷新后恢复的描述");
  await expect(page.getByRole("button", { name: "保存", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(description).toHaveCount(0);
  expect(await storedDraft(page)).toBeNull();

  await page.getByRole("button", { name: "编辑描述", exact: true }).click();
  await description.fill("将被删除的草稿");
  await page.reload();
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: "删除本机草稿", exact: true }).click();
  await expect(notice).toHaveCount(0);
  expect(await storedDraft(page)).toBeNull();
  expect((await savedTask(page)).description).toBe("");
});

test("sign-out keeps drafts when cancelled or failed and removes this user's stored drafts only after it succeeds", async ({ page }) => {
  await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
  // 共享浏览器上另一账号遗留的草稿在应用外壳加载时删除。
  const foreign = `orbit:draft:another-account:${project.id}:${task.id}`;
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ expectedVersion: 1, title: "上一账号的文字", savedAt: Date.now() })), foreign);
  await page.reload();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), foreign)).toBeNull();

  await page.getByRole("button", { name: "编辑描述", exact: true }).click();
  await page.getByRole("textbox", { name: "编辑描述", exact: true }).fill("退出前的私有草稿");
  await expect.poll(() => storedDraft(page)).not.toBeNull();
  let accept = false;
  page.on("dialog", async (dialog) => { if (accept) await dialog.accept(); else await dialog.dismiss(); });
  await page.getByRole("button", { name: "账户菜单", exact: true }).first().click();
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  expect(await storedDraft(page)).not.toBeNull();
  accept = true;
  await page.route("**/api/auth/sign-out", (route) => route.abort("failed"));
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  await expect(page.getByText("退出失败", { exact: true })).toBeVisible();
  expect(await storedDraft(page)).not.toBeNull();
  await page.unroute("**/api/auth/sign-out");
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/login/);
  expect(await storedDraft(page)).toBeNull();
});

test("the board keeps working when the open task is deleted elsewhere and the panel keeps the comment draft", async ({ page }) => {
  await page.goto(`/app/projects/${project.id}/board?task=${task.id}`);
  // 项目名在吸顶的项目栏里，看板本身是 [data-project-content]；面板打开时两者都在模态背后。
  const projectTitle = page.locator("#app-main h1");
  const board = page.locator("#app-main [data-project-content]");
  await expect(projectTitle).toHaveText(project.name);
  await expect(board).toBeVisible();
  const comment = page.getByRole("textbox", { name: "评论正文", exact: true });
  await comment.fill("任务删除时仍在编辑的评论");
  await deleteElsewhere(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert").filter({ hasText: "该任务已被删除" })).toBeVisible();
  await expect(comment).toHaveValue("任务删除时仍在编辑的评论");
  await expect(projectTitle).toHaveText(project.name);
  await expect(board).toBeVisible();
  await expect(page.getByText("无法访问此页面")).toHaveCount(0);
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.getByRole("button", { name: "放弃更改", exact: true }).click();
  await expect(page).not.toHaveURL(/task=/);
});

for (const view of ["board", "tasks"] as const) {
  test(`a stale ?task= link on the ${view} page shows a notice instead of a 404 page`, async ({ page }) => {
    await deleteElsewhere(page);
    const response = await page.goto(`/app/projects/${project.id}/${view}?task=${task.id}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "任务不存在或已被删除" })).toBeVisible();
    await expect(page.getByText("无法访问此页面")).toHaveCount(0);
    await page.getByRole("button", { name: "关闭详情", exact: true }).click();
    await expect(page).not.toHaveURL(/task=/);
  });
}

test("the standalone task page keeps drafts visible when the task is deleted elsewhere", async ({ page }) => {
  await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
  await expect(page.getByRole("heading", { level: 1, name: task.title })).toBeVisible();
  const comment = page.getByRole("textbox", { name: "评论正文", exact: true });
  await comment.fill("删除前写下的评论");
  await deleteElsewhere(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert").filter({ hasText: "该任务已被删除" })).toBeVisible();
  await expect(comment).toHaveValue("删除前写下的评论");
  const direct = await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
  expect(direct?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "任务不存在或已被删除" })).toBeVisible();
});

test("without the Navigation API, back from a panel still guards its comment draft", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "navigation", { value: undefined, configurable: true }));
  const listPath = `/app/projects/${project.id}/tasks`;
  await page.goto(listPath);
  await page.locator(`[data-task-link="${task.id}"]`).first().click();
  await expect(page).toHaveURL(new RegExp("task=" + task.id));
  const comment = page.getByRole("textbox", { name: "评论正文", exact: true });
  await comment.fill("后退时需要保护的评论");
  let dialogs = 0;
  page.once("dialog", async (dialog) => { dialogs++; await dialog.dismiss(); });
  await page.goBack();
  await expect.poll(() => dialogs).toBe(1);
  await expect(page).toHaveURL(new RegExp("task=" + task.id));
  await expect(comment).toHaveValue("后退时需要保护的评论");
  page.once("dialog", async (dialog) => { dialogs++; await dialog.accept(); });
  await page.goBack();
  await expect(page).not.toHaveURL(/task=/);
  expect(dialogs).toBe(2);
  await expect(comment).toHaveCount(0);
});
