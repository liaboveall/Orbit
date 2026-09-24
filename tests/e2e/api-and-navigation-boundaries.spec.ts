import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { establishSessionCookies } from "../ui/auth-setup";
import { cleanupTestEmails } from "./support/db";

let emails: string[] = [], projectId: string;
test.beforeEach(async ({ request, context, baseURL }) => {
  const meta: { email?: string } = {};
  try { await context.addCookies(await establishSessionCookies(request, baseURL!, meta)); }
  finally { if (meta.email) emails.push(meta.email); }
  const response = await request.post("/api/v1/projects", { headers: { origin: baseURL!, "Idempotency-Key": randomUUID() },
    data: { name: "最近项目键盘验收", key: "C" + randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase() } });
  expect(response.status()).toBe(201); projectId = (await response.json()).data.id;
});
test.afterEach(async ({ page }) => { await page.close(); await cleanupTestEmails(emails); emails = []; });

test("API root and unknown paths return JSON without shadowing known routes", async ({ request }) => {
  for (const path of ["/api/v1", "/api/v1/not-a-real-endpoint", "/api/v1/not/a/real/endpoint"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(404);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" }, meta: { requestId: expect.any(String) } });
  }
  expect((await request.get("/api/v1/me")).status()).toBe(200);
  const head = await request.head("/api/v1/not-a-real-endpoint");
  expect(head.status()).toBe(404); expect(await head.body()).toHaveLength(0);
});

test("settings remains usable with 200 percent CSS zoom and keyboard navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/settings");
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  const name = page.getByRole("textbox", { name: "姓名", exact: true });
  await expect(name).toBeVisible(); await name.focus(); await expect(name).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await name.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
});

test("production sidebar opens real projects and recovers from a project-list failure", async ({ page }) => {
  await page.goto("/app/today");
  const link = page.locator("aside").getByRole("link", { name: "最近项目键盘验收", exact: true });
  await expect(link).toHaveAttribute("href", `/app/projects/${projectId}/board`);
  await expect(page.locator('a[href^="/app/samples/"]')).toHaveCount(0);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/board`));
  await page.route("**/api/v1/projects?scope=all&archived=exclude&limit=6", route => route.abort());
  await page.reload();
  await page.getByRole("button", { name: "重新加载最近项目" }).waitFor();
  await page.unroute("**/api/v1/projects?scope=all&archived=exclude&limit=6");
  await page.getByRole("button", { name: "重新加载最近项目" }).click();
  await expect(link).toBeVisible();
});

test("mobile tabs link panels and support arrows/Home/End; desktop remains three labelled columns", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/projects/${projectId}/board`);
  const tabs = page.getByRole("tablist", { name: "看板状态" }).getByRole("tab");
  await tabs.first().focus();
  await tabs.first().press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel");
  await expect(panel).toHaveCount(1);
  await expect(panel).toHaveAttribute("id", (await tabs.nth(1).getAttribute("aria-controls"))!);
  await tabs.nth(1).press("End"); await expect(tabs.last()).toBeFocused();
  await tabs.last().press("Home"); await expect(tabs.first()).toBeFocused();
  const results = await new AxeBuilder({ page }).include('[role="tablist"]').include('[role="tabpanel"]').analyze();
  expect(results.violations.filter(v => ["critical", "serious"].includes(v.impact ?? ""))).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("tabpanel")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "待办列", exact: true })).toBeVisible();
});

test("settings IME submission stays local until composition ends", async ({ page }) => {
  await page.goto("/app/settings");
  const input = page.getByRole("textbox", { name: "姓名", exact: true });
  await input.fill("输入中的姓名");
  let saves = 0;
  page.on("request", request => { if (request.method() === "PATCH" && request.url().endsWith("/api/v1/me")) saves++; });
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true });
  // A submit event while composition is active must also be rejected by the form.
  await input.locator("xpath=ancestor::form").evaluate((form: HTMLFormElement) => form.requestSubmit());
  expect(saves).toBe(0);
  await expect(input).toHaveValue("输入中的姓名");
  await input.dispatchEvent("compositionend");
  const saved = page.waitForResponse(r => r.url().endsWith("/api/v1/me") && r.request().method() === "PATCH");
  await input.press("Enter");
  expect((await saved).status()).toBe(200);
});

// OI-25：Dialog 组合输入期间的 Escape 是取消候选词，不得关闭对话框；
// 组合结束后 Escape 正常关闭。合成事件无法完全替代真实中文输入法验收
// （候选窗口取消路径因平台/引擎而异），此处验证可自动化的键盘语义。
test("dialog stays open for composing Escape and closes after composition ends", async ({ page, request }) => {
  const task = await request.post(`/api/v1/projects/${projectId}/tasks`, {
    headers: { origin: process.env.E2E_AUTH_ORIGIN!, "Idempotency-Key": randomUUID() }, data: { title: "IME 对话框验收" },
  });
  expect(task.status()).toBe(201);
  const taskId = (await task.json()).data.id;
  await page.goto(`/app/projects/${projectId}/tasks?task=${taskId}`);
  await page.getByRole("button", { name: "IME 对话框验收", exact: true }).click();
  const input = page.getByRole("textbox", { name: "编辑标题", exact: true });
  await input.fill("组合中的标题草稿");
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "你有未保存的更改", exact: true });
  await expect(dialog).toBeVisible();
  // 组合期间的 Escape（isComposing 与 legacy keyCode 229 两种形态）：候选取消，对话框保留。
  // 事件派发到对话框内聚焦的「保留编辑」按钮（onCloseAutoFocus 落点），冒泡到窗口捕获层。
  const keep = dialog.getByRole("button", { name: "保留编辑", exact: true });
  await expect(keep).toBeFocused();
  const nativeCancellationAllowed = await keep.evaluate(element => {
    const event = new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true });
    return element.dispatchEvent(event) && !event.defaultPrevented;
  });
  expect(nativeCancellationAllowed).toBe(true);
  await expect(dialog).toBeVisible();
  await keep.dispatchEvent("keydown", { key: "Escape", keyCode: 229, bubbles: true, cancelable: true });
  await expect(dialog).toBeVisible();
  // 组合结束后的普通 Escape：对话框关闭。
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
