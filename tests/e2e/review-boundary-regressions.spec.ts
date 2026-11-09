import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { establishSessionCookies } from "../ui/auth-setup";
import { cleanupTestEmails } from "./support/db";
import { ProjectSchema, TaskSchema, SubtaskSchema, SuccessResponseSchema, type ProjectDTO, type TaskDTO } from "../../src/contracts";

// Regression acceptance: retain local text through remote deletion and archive.
const origin = process.env.E2E_AUTH_ORIGIN!;
const headers = () => ({ origin, "Idempotency-Key": randomUUID() });
let emails: string[] = [], project: ProjectDTO, task: TaskDTO;
test.beforeEach(async ({ request, context, baseURL }) => {
  const meta: { email?: string } = {};
  try { await context.addCookies(await establishSessionCookies(request, baseURL!, meta)); }
  finally { if (meta.email) emails.push(meta.email); }
  const created = await request.post("/api/v1/projects", { headers: headers(), data: { name: "Review synthetic project", key: "R" + randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase() } });
  expect(created.status()).toBe(201);
  project = SuccessResponseSchema(ProjectSchema).parse(await created.json()).data;
  const response = await request.post(`/api/v1/projects/${project.id}/tasks`, { headers: headers(), data: { title: "Review synthetic task" } });
  expect(response.status()).toBe(201);
  task = SuccessResponseSchema(TaskSchema).parse(await response.json()).data;
});
test.afterEach(async ({ page }) => { await page.close(); await cleanupTestEmails(emails); emails = []; });

for (const surface of ["standalone", "panel"] as const) for (const field of ["title", "description"] as const) {
  test(`preserve ${field} draft on real PATCH 404: ${surface}`, async ({ page, request }) => {
    await page.goto(surface === "standalone" ? `/app/projects/${project.id}/tasks/${task.id}` : `/app/projects/${project.id}/board?task=${task.id}`);
    await expect(page.getByRole("textbox", { name: "评论正文", exact: true })).toBeVisible();
    const label = field === "title" ? "编辑标题" : "编辑描述";
    if (field === "title") {
      await page.getByRole("button", { name: "更多操作", exact: true }).click();
      await page.getByRole("menuitem", { name: "编辑标题", exact: true }).click();
    } else await page.getByRole("button", { name: label, exact: true }).click();
    const draft = "Synthetic unsaved description that must survive a rejected save";
    await page.getByRole("textbox", { name: label, exact: true }).fill(draft);
    const key = `orbit:draft:${task.creator.id}:${project.id}:${task.id}`;
    await expect.poll(() => page.evaluate(k => localStorage.getItem(k), key)).not.toBeNull();
    const deleted = await request.delete(`/api/v1/tasks/${task.id}?expectedVersion=${task.version}`, { headers: { origin } });
    expect(deleted.status()).toBe(200);
    const saving = page.waitForResponse(r => r.url().endsWith(`/api/v1/tasks/${task.id}`) && r.request().method() === "PATCH");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    expect((await saving).status()).toBe(404);
    await expect(page.getByRole("textbox", { name: label, exact: true })).toHaveValue(draft);
    await expect(page.getByRole("textbox", { name: label, exact: true })).toHaveAttribute("readonly", "");
    await expect.poll(() => page.evaluate(k => localStorage.getItem(k), key)).not.toBeNull();
    if (surface === "panel") await expect(page).toHaveURL(/task=/);
    else await expect(page.getByRole("alert").filter({ hasText: "该任务已被删除" })).toBeVisible();
  });
}

test("preserve editing subtask by background deletion refresh", async ({ page, request }) => {
  const response = await request.post(`/api/v1/tasks/${task.id}/subtasks`, { headers: headers(), data: { title: "Review subtask" } });
  expect(response.status()).toBe(201);
  const subtask = SuccessResponseSchema(SubtaskSchema).parse(await response.json()).data;
  await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
  await page.getByRole("button", { name: "编辑子任务", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "编辑子任务标题", exact: true });
  await editor.fill("Synthetic unsaved subtask edit");
  expect((await request.delete(`/api/v1/subtasks/${subtask.id}?expectedVersion=${subtask.version}`, { headers: { origin } })).status()).toBe(204);
  let dialogs = 0;
  page.on("dialog", async dialog => { dialogs++; await dialog.dismiss(); });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(editor).toHaveValue("Synthetic unsaved subtask edit");
  await expect(editor).toHaveAttribute("readonly", "");
  expect(dialogs).toBe(0);
});

for (const kind of ["subtasks", "comments"] as const) {
  test(`retain an editing ${kind} row after parent deletion`, async ({ page, request }) => {
    expect((await request.post(`/api/v1/tasks/${task.id}/${kind}`, {
      headers: headers(), data: kind === "subtasks" ? { title: "Child" } : { body: "Child" },
    })).status()).toBe(201);
    await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
    await page.getByRole("button", { name: kind === "subtasks" ? "编辑子任务" : "编辑评论", exact: true }).click();
    const editor = page.getByRole("textbox", { name: kind === "subtasks" ? "编辑子任务标题" : "编辑评论内容", exact: true });
    await editor.fill("Unsaved child text");
    expect((await request.delete(`/api/v1/tasks/${task.id}?expectedVersion=${task.version}`, { headers: { origin } })).status()).toBe(200);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(editor).toHaveValue("Unsaved child text");
    await expect(editor).toHaveAttribute("readonly", "");
  });
}

test("preserve a new comment draft after remote archive", async ({ page, request }) => {
  await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
  const editor = page.getByRole("textbox", { name: "评论正文", exact: true });
  const draft = "Synthetic comment retained in state but hidden from its author";
  await editor.fill(draft);
  const response = await request.patch(`/api/v1/projects/${project.id}`, { headers: { origin }, data: { expectedVersion: project.version, archived: true } });
  expect(response.status()).toBe(200);
  const archived = SuccessResponseSchema(ProjectSchema).parse(await response.json()).data;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("项目已归档 · 只读", { exact: true })).toBeVisible();
  await expect(editor).toHaveValue(draft);
  await expect(editor).toHaveAttribute("readonly", "");
  expect((await request.patch(`/api/v1/projects/${project.id}`, { headers: { origin }, data: { expectedVersion: archived.version, archived: false } })).status()).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(editor).toHaveValue(draft);
});
