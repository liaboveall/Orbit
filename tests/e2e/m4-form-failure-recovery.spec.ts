import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import {
  ProjectSchema,
  SuccessResponseSchema,
  type ProjectDTO,
} from "../../src/contracts";
import { establishSessionCookies } from "../ui/auth-setup";
import { cleanupTestEmails, withTestDb } from "./support/db";

/**
 * M4 收尾工作项 4b / 缺口 3：主要表单在**失败后的恢复行为**回归（真实浏览器）。
 *
 * 背景：既有 m4-activity.spec.ts 的 A06 已用真实浏览器覆盖项目设置表单的 **409 冲突** 恢复
 * （只提交 dirty 字段、不 clobber 未编辑字段）。但 **429 / 500 / 网络失败** 这几类失败下的
 * 组件级恢复行为——(a) 提交按钮 pending 态被释放、可再次点击，(b) 显示对应错误提示，
 * (c) 用户已填草稿未丢失——此前无测试。本文件用现有 Playwright E2E 框架 + `page.route`
 * 拦截 API 返回特定状态码补齐，**不引入** jsdom/@testing-library/react 组件级单测依赖。
 *
 * 覆盖两个主要写表单各三种失败：
 *  1. 项目设置表单（PATCH /api/v1/projects/{id}，project-settings-form.tsx）；
 *  2. 任务创建表单（POST /api/v1/projects/{id}/tasks，task-create-form.tsx）。
 * 失败种类：429 RATE_LIMITED、500 INTERNAL_ERROR、网络失败（route.abort）。
 *
 * 断言依据（对照生产实现）：
 *  - 设置表单：非 401/409 业务错误 → `setProfileError(result.error.message)`；传输层异常
 *    （ApiClientError）→ catch 分支 "无法连接服务器，请检查网络后重试。"；finally 释放
 *    `setSavingProfile(false)`；name/description 草稿保存在组件 state，失败不清空。
 *  - 任务创建表单：非特定业务错误 → `setFormError(result.error.message)`；传输层异常 →
 *    "无法连接服务器，请检查网络后重试。"；finally 释放 `setPending(false)`；title 草稿
 *    保存在组件 state，失败不清空（且保留原幂等键，重试命中 replay）。
 *
 * ⚠️ 运行前置：`pnpm test:e2e` 会通过 scripts/e2e-server.mjs 自建连接 orbit_test 的测试服务；
 *   Mailpit 需在线。数据副作用在 afterEach 精确回收，不触碰 orbit_dev、不清空库。
 */

dotenv.config({ path: [".env.local", ".env"], quiet: true });
test.describe.configure({ mode: "serial" });

const origin =
  process.env.E2E_AUTH_ORIGIN ?? `http://localhost:${process.env.E2E_PORT ?? "3100"}`;

/** 构造一个符合统一错误信封（ErrorResponseSchema）的响应体，供 route.fulfill 使用。 */
function errorEnvelope(code: string, message: string, requestId: string): string {
  return JSON.stringify({ error: { code, message }, meta: { requestId } });
}

const RATE_LIMIT_MSG = "请求过于频繁，请稍后再试。";
const INTERNAL_ERROR_MSG = "服务器内部错误，请稍后重试。";
const NETWORK_MSG = "无法连接服务器，请检查网络后重试。";

let project: ProjectDTO;
let createdEmails: string[] = [];

async function createProject(request: APIRequestContext, name: string): Promise<ProjectDTO> {
  const res = await request.post("/api/v1/projects", {
    headers: { origin, "Idempotency-Key": randomUUID() },
    data: { name, key: "M" + randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase() },
  });
  expect(res.status()).toBe(201);
  return SuccessResponseSchema(ProjectSchema).parse(await res.json()).data;
}

test.beforeEach(async ({ request, context, baseURL }) => {
  createdEmails = [];
  const metaA: { email?: string } = {};
  const cookiesA = await establishSessionCookies(request, baseURL!, metaA);
  createdEmails.push(metaA.email!);
  await context.addCookies(cookiesA);
  project = await createProject(request, "M4 失败恢复项目");
});

test.afterEach(async () => {
  const result = await cleanupTestEmails(createdEmails);
  console.log(
    `[m4-form-failure-recovery] beforeEach 创建的 ${createdEmails.length} 个邮箱已清理：` +
      `清理计数=${JSON.stringify(result.cleanedCount)}${result.error ? ` (error: ${result.error})` : ''}`,
  );
  createdEmails = [];
  
  // 日志：显示隔离验证结果
  await withTestDb(async (client) => {
    const testCheck = await client.query('SELECT COUNT(*) FROM "Project"');
    console.log(
      `[isolation] orbit_test 清理后统计：Project=${testCheck.rows[0].count}`,
    );
  });
});

/* ── 打开设置表单并填入 name 草稿（返回保存按钮与 name 输入框定位器）──────── */
async function openSettingsWithDraft(page: Page, draftName: string) {
  await page.goto(`/app/projects/${project.id}/settings`);
  await expect(page.getByRole("heading", { name: "项目设置", exact: true })).toBeVisible();
  const nameInput = page.getByLabel("项目名称", { exact: true });
  await nameInput.fill(draftName);
  const saveButton = page.getByRole("button", { name: "保存修改", exact: true });
  await expect(saveButton).toBeEnabled();
  return { nameInput, saveButton };
}

/* ── 打开任务创建表单并填入 title 草稿 ─────────────────────────────────── */
async function openTaskCreateWithDraft(page: Page, draftTitle: string) {
  await page.goto(`/app/projects/${project.id}/board`);
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const titleInput = page.getByRole("textbox", { name: "任务标题", exact: true });
  await expect(titleInput).toBeVisible();
  await titleInput.fill(draftTitle);
  const submitButton = page.getByRole("button", { name: "创建任务", exact: true });
  await expect(submitButton).toBeEnabled();
  return { titleInput, submitButton };
}

/* ══════════════════════════════════════════════════════════════════════
 * 项目设置表单（PATCH /api/v1/projects/{id}）
 * ══════════════════════════════════════════════════════════════════════ */

test("设置表单：429 后释放 pending、显示限流提示、保留名称草稿", async ({ page }) => {
  const DRAFT = "429 场景下的名称草稿";
  const { nameInput, saveButton } = await openSettingsWithDraft(page, DRAFT);

  await page.route(`**/api/v1/projects/${project.id}`, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 429,
          contentType: "application/json",
          body: errorEnvelope("RATE_LIMITED", RATE_LIMIT_MSG, "e2e-429-settings"),
        })
      : route.continue(),
  );

  await saveButton.click();

  // (b) 显示对应错误提示（信封 message 驻留在 InlineError role=alert）。
  await expect(page.getByText(RATE_LIMIT_MSG, { exact: true })).toBeVisible();
  // (a) pending 释放：保存按钮重新可用、不再处于「正在保存…」。
  await expect(saveButton).toBeEnabled();
  await expect(page.getByRole("button", { name: "正在保存…" })).toHaveCount(0);
  // (c) 草稿未丢失：名称输入框仍是用户填的值。
  await expect(nameInput).toHaveValue(DRAFT);
});

test("设置表单：500 后释放 pending、显示服务器错误提示、保留名称草稿", async ({ page }) => {
  const DRAFT = "500 场景下的名称草稿";
  const { nameInput, saveButton } = await openSettingsWithDraft(page, DRAFT);

  await page.route(`**/api/v1/projects/${project.id}`, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: errorEnvelope("INTERNAL_ERROR", INTERNAL_ERROR_MSG, "e2e-500-settings"),
        })
      : route.continue(),
  );

  await saveButton.click();

  await expect(page.getByText(INTERNAL_ERROR_MSG, { exact: true })).toBeVisible();
  await expect(saveButton).toBeEnabled();
  await expect(page.getByRole("button", { name: "正在保存…" })).toHaveCount(0);
  await expect(nameInput).toHaveValue(DRAFT);
});

test("设置表单：网络失败后释放 pending、显示连接失败提示、保留名称草稿，且解除拦截后可重试成功", async ({
  page,
}) => {
  const DRAFT = "网络失败场景的名称草稿";
  const { nameInput, saveButton } = await openSettingsWithDraft(page, DRAFT);

  await page.route(`**/api/v1/projects/${project.id}`, (route) =>
    route.request().method() === "PATCH"
      ? route.abort("internetdisconnected")
      : route.continue(),
  );

  await saveButton.click();

  await expect(page.getByText(NETWORK_MSG, { exact: true })).toBeVisible();
  await expect(saveButton).toBeEnabled();
  await expect(nameInput).toHaveValue(DRAFT);

  // 解除拦截后重试：草稿仍在，按钮可用，保存成功（证明失败未把表单卡死）。
  await page.unroute(`**/api/v1/projects/${project.id}`);
  const retry = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/v1/projects/${project.id}`),
  );
  await saveButton.click();
  const settled = await retry;
  expect(settled.status()).toBe(200);
});

/* ══════════════════════════════════════════════════════════════════════
 * 任务创建表单（POST /api/v1/projects/{id}/tasks）
 * ══════════════════════════════════════════════════════════════════════ */

test("任务创建表单：429 后释放 pending、显示限流提示、保留标题草稿", async ({ page }) => {
  const DRAFT = "429 场景下的任务标题草稿";
  const { titleInput, submitButton } = await openTaskCreateWithDraft(page, DRAFT);

  await page.route(`**/api/v1/projects/${project.id}/tasks`, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 429,
          contentType: "application/json",
          body: errorEnvelope("RATE_LIMITED", RATE_LIMIT_MSG, "e2e-429-task"),
        })
      : route.continue(),
  );

  await submitButton.click();

  await expect(page.getByText(RATE_LIMIT_MSG, { exact: true })).toBeVisible();
  await expect(submitButton).toBeEnabled();
  await expect(page.getByRole("button", { name: "正在创建…" })).toHaveCount(0);
  await expect(titleInput).toHaveValue(DRAFT);
});

test("任务创建表单：500 后释放 pending、显示服务器错误提示、保留标题草稿", async ({ page }) => {
  const DRAFT = "500 场景下的任务标题草稿";
  const { titleInput, submitButton } = await openTaskCreateWithDraft(page, DRAFT);

  await page.route(`**/api/v1/projects/${project.id}/tasks`, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: errorEnvelope("INTERNAL_ERROR", INTERNAL_ERROR_MSG, "e2e-500-task"),
        })
      : route.continue(),
  );

  await submitButton.click();

  await expect(page.getByText(INTERNAL_ERROR_MSG, { exact: true })).toBeVisible();
  await expect(submitButton).toBeEnabled();
  await expect(page.getByRole("button", { name: "正在创建…" })).toHaveCount(0);
  await expect(titleInput).toHaveValue(DRAFT);
});

test("任务创建表单：网络失败后释放 pending、显示连接失败提示、保留标题草稿", async ({ page }) => {
  const DRAFT = "网络失败场景的任务标题草稿";
  const { titleInput, submitButton } = await openTaskCreateWithDraft(page, DRAFT);

  await page.route(`**/api/v1/projects/${project.id}/tasks`, (route) =>
    route.request().method() === "POST"
      ? route.abort("internetdisconnected")
      : route.continue(),
  );

  await submitButton.click();

  await expect(page.getByText(NETWORK_MSG, { exact: true })).toBeVisible();
  await expect(submitButton).toBeEnabled();
  await expect(page.getByRole("button", { name: "正在创建…" })).toHaveCount(0);
  await expect(titleInput).toHaveValue(DRAFT);
});
