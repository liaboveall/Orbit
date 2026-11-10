import {cleanupTestEmails} from "../e2e/support/db";
import { expect, test, type Cookie, type Locator, type Page } from "@playwright/test";
import { establishSessionCookies, createProjectAndTask } from "./auth-setup";

const title = "UI 测试任务";
const dialogName = "任务详情";

const sessionMeta: { email?: string } = {};
test.afterAll(async () => {
  if (sessionMeta.email) await cleanupTestEmails([sessionMeta.email]);
});

let sessionCookies: Cookie[] | undefined;
let projectId: string;
let taskId: string;

test.beforeEach(async ({ context, request, baseURL }) => {
  if (!sessionCookies) {
    if (!baseURL) throw new Error("Missing isolated Playwright baseURL");
    const cookies = await establishSessionCookies(request, baseURL, sessionMeta);
    ({ projectId, taskId } = await createProjectAndTask(request, baseURL));
    sessionCookies = cookies;
  }
  await context.addCookies(sessionCookies);
});

function boardPath() {
  return "/app/projects/" + projectId + "/board";
}

function taskLink(page: Page) {
  return page.getByRole("link", { name: title, exact: true });
}

async function openBoard(page: Page) {
  await page.goto(boardPath());
  await expect(taskLink(page)).toBeVisible();
}

async function expectFocusInside(dialog: Locator) {
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
}

for (const width of [768, 1024, 1440]) {
  test(`${width}px 导航有名称、项目标记可见且键盘可以进入项目`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1024 });
    await page.goto("/app/today");
    const nav = page.getByRole("navigation", { name: "主导航" });
    await expect(nav.getByRole("link", { name: "我的工作台", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "全部项目", exact: true })).toBeVisible();
    // 列表里只有最近项目；工作台和全部项目是列表之外的两个固定入口。
    const projects = nav.locator("ul a");
    await expect(projects).toHaveCount(1);
    for (const link of await projects.all()) {
      await expect(link).toHaveAccessibleName(/\S+/);
      // 实际绘制尺寸断言可捕获“空内联 span 有 width 类但没有宽度”的回归。
      const dot = link.locator('span[aria-hidden="true"]:visible');
      await expect(dot).toHaveCount(1);
      const bounds = await dot.boundingBox();
      expect(bounds?.width).toBeGreaterThan(0);
      expect(bounds?.height).toBeGreaterThan(0);
    }
    const destination = nav.locator(`a[href="/app/projects/${projectId}/board"]`);
    await destination.focus();
    await expect(destination).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/app/projects/${projectId}/board$`));
  });
}

test("390px 导航抽屉保持 Escape 关闭并恢复焦点", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBoard(page);
  const trigger = page.getByRole("button", { name: "打开导航菜单" });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "导航", exact: true });
  await expect(drawer).toBeVisible();
  await expectFocusInside(drawer);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const width of [390, 768, 1440]) {
  test(`${width}px 任务面板隔离背景、循环焦点并恢复任务卡`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openBoard(page);
    const trigger = taskLink(page);
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: dialogName, exact: true });
    await expect(dialog).toBeVisible();
    await expectFocusInside(dialog);
    await expect(page.getByRole("searchbox", { name: "搜索任务" })).toHaveCount(0);
    const first = dialog.getByRole("button", { name: "复制链接", exact: true });
    const last = dialog.getByRole("button", { name: "选择文件", exact: true });
    await last.click({ trial: true });
    await last.focus();
    await page.keyboard.press("Tab");
    await expect(first).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(last).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(boardPath());
    await expect(trigger).toBeFocused();
  });

  test(`${width}px 草稿在 Escape/关闭按钮时确认，保留或放弃后焦点正确`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openBoard(page);
    const trigger = taskLink(page);
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: dialogName, exact: true });
    await dialog.getByRole("button", { name: title, exact: true }).click();
    const input = dialog.getByRole("textbox", { name: "编辑标题" });
    await input.fill("保留这份未保存的草稿");
    await page.keyboard.press("Escape");
    const confirm = page.getByRole("dialog", { name: "你有未保存的更改", exact: true });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "保留编辑", exact: true }).click();
    await expect(input).toHaveValue("保留这份未保存的草稿");
    await expect(input).toBeFocused();
    await dialog.getByRole("button", { name: "关闭详情", exact: true }).click();
    await expect(confirm).toBeVisible();
    // 内层 Escape 只取消确认，不能连带关闭详情。
    //
    // 先等确认框真正接管焦点，再发 Escape：Radix 的 DismissableLayer 键盘监听与
    // FocusScope 在同一提交阶段注册，仅 toBeVisible() 通过时该监听可能尚未挂载，
    // Escape 会被整个丢弃（确认框停留在完全打开且已聚焦的状态，并非关闭动画竞态——
    // dialog/drawer 均无退出动画）。768px 恰为 Tailwind md 断点边界，样式重排更易跨帧，
    // 因此该竞态只在此宽度复现，而 390/1440 通过。
    // 这是同步屏障而非放宽断言：下面仍严格要求确认框计数归零。
    await expect(confirm.getByRole("button", { name: "保留编辑", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "关闭详情" })).toBeFocused();
    await dialog.getByRole("button", { name: "关闭详情" }).click();
    await confirm.getByRole("button", { name: "放弃更改", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

test("桌面点击遮罩也保护草稿", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBoard(page);
  await taskLink(page).click();
  const dialog = page.getByRole("dialog", { name: dialogName, exact: true });
  await dialog.getByRole("button", { name: title, exact: true }).click();
  await dialog.getByRole("textbox", { name: "编辑标题" }).fill("遮罩关闭也须确认");
  await page.mouse.click(300, 200);
  await expect(page.getByRole("dialog", { name: "你有未保存的更改", exact: true })).toBeVisible();
});

test("面板打开期间跨断点，关闭后焦点不会丢失到隐藏卡片", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBoard(page);
  await taskLink(page).click();
  const dialog = page.getByRole("dialog", { name: dialogName, exact: true });
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await dialog.getByRole("button", { name: "关闭详情" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement;
    return active !== document.body && (active?.getClientRects().length ?? 0) > 0;
  })).toBe(true);
});

test("直接访问面板关闭后保留其他参数；独立详情页不锁焦点", async ({ page }) => {
  const duplicateKeyErrors: string[] = [];
  page.on("console", message => {
    if (message.text().includes("same key")) duplicateKeyErrors.push(message.text());
  });
  await page.goto(`${boardPath()}?q=UI&task=${taskId}`);
  const dialog = page.getByRole("dialog", { name: dialogName, exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "关闭详情" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(`${boardPath()}?q=UI`);
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");

  await page.goto(`/app/projects/${projectId}/tasks/${taskId}`);
  // 独立详情页（variant="page"）应正常渲染且**不锁焦点**：非模态、无面板关闭入口。
  await expect(page.getByRole("link", { name: "返回看板", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "关闭详情" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "编辑描述" })).toBeVisible();
  expect(duplicateKeyErrors).toEqual([]);
});
