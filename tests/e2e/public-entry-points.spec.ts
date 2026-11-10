import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("public demo is isolated, keyboard usable, responsive and accessible", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", r => { if (new URL(r.url()).pathname.startsWith("/api/")) apiCalls.push(r.method()); });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/demo");
    await expect(page.getByRole("heading", { name: "校园活动报名系统" })).toBeVisible();
    const scan = await new AxeBuilder({ page }).analyze();
    expect(scan.violations.filter(v => ["critical", "serious"].includes(v.impact ?? ""))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/public-demo-${width}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("演示为只读");
  await page.getByRole("textbox", { name: "搜索演示任务" }).fill("no-match-xyz");
  await expect(page.getByText("没有匹配的任务，试试其他关键词。")).toBeVisible();
  await page.getByRole("textbox", { name: "搜索演示任务" }).fill("");
  await page.getByRole("button", { name: "列表", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "活动", exact: true }).click();
  await expect(page.getByRole("heading", { name: "项目动态（演示）" })).toBeVisible();
  expect(apiCalls).toEqual([]);
});

test("health routes distinguish liveness and readiness", async ({ request }) => {
  expect((await request.get("/health/live")).status()).toBe(200);
  expect((await request.get("/health/ready")).status()).toBe(200);
});

test("首页返回 200 并渲染 Orbit 基线", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle(/Orbit/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("有序向前");
  await expect(page.getByRole("link", { name: "体验只读演示" })).toHaveAttribute("href", "/demo");
  // 界面预览由真实组件渲染：对辅助技术是一张图，内部整体 inert，不引用图片文件。
  const preview = page.getByRole("img", { name: /Orbit 看板界面预览/ });
  await expect(preview).toBeVisible();
  await expect(preview.locator("p", { hasText: "校园活动报名系统" })).toBeVisible();
  expect(
    await preview.evaluate((el) => ({ images: el.querySelectorAll("img").length, inert: el.querySelector("[inert]") !== null })),
  ).toEqual({ images: 0, inert: true });
});
