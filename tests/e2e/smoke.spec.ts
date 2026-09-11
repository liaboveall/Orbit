import { expect, test } from "@playwright/test";

/**
 * e2e 冒烟（M0 最小真实断言）：验证 Next.js 应用可访问并渲染 M0 基线首页。
 * 更完整的用户流程在后续里程碑补充。运行前需安装浏览器（见 tests/README.md）。
 */
test("首页返回 200 并渲染 Orbit 基线", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle(/Orbit/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Orbit");
});
