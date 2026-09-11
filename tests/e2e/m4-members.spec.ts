import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import {
  MemberSchema,
  ProjectSchema,
  SuccessResponseSchema,
  type MemberDTO,
  type ProjectDTO,
} from "../../src/contracts";
import { z } from "zod";
import { establishSessionCookies } from "../ui/auth-setup";
import { cleanupTestEmails, withTestDb } from "./support/db";

/**
 * M4 / ORB-014：成员管理纵向闭环 E2E（真实浏览器）。
 *
 * 覆盖任务 Part 4：
 *  - owner 登录 → 成员页 → 校验成员列表（owner 首位「所有者」+（你），成员「成员」徽标）；
 *  - owner 移除成员（二次确认对话框）→ 成员从列表消失（服务端权威复核 + API 404）；
 *  - 被移除成员登录 → 无法再访问本项目（notFound UI「无法访问此页面」+ API 404）；
 *  - 成员自我退出流程（「退出项目」→ 确认 → 硬跳转 /app/projects → 不再是成员）。
 *
 * 与 m3-workflows.spec.ts 同一套基础设施：establishSessionCookies 走真实认证链路；
 * 第二/第三名用户用**独立 APIRequestContext + 独立浏览器上下文**承载，互不串会话；
 * 成员关系用原生 SQL 直接写入**独立测试库**（TEST_DATABASE_URL，见 tests/e2e/support/db.ts，
 * A10 修复：此前直连 DATABASE_URL/orbit_dev），数据副作用在 afterEach 精确回收。
 *
 * ⚠️ 运行前置：`pnpm test:e2e` 会通过 scripts/e2e-server.mjs 自建连接 orbit_test 的测试
 * 服务；Mailpit 均需在线；否则用例失败（属预期）。
 */

dotenv.config({ path: [".env.local", ".env"], quiet: true });
test.describe.configure({ mode: "serial" });

/** 默认端口 3100，对齐 scripts/e2e-server.mjs 的 E2E_PORT 默认值（测试专用服务）。 */
const origin = process.env.E2E_AUTH_ORIGIN ?? `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const MemberListSuccess = SuccessResponseSchema(z.array(MemberSchema));

let project: ProjectDTO;
/** 本用例派生的额外浏览器上下文（第二/第三名用户），afterEach 统一关闭。 */
let extraContexts: BrowserContext[] = [];
/** 本用例在库中留下的全部用户邮箱，afterEach 精确回收。 */
let createdEmails: string[] = [];

/** 以当前会话经 API 创建项目。 */
async function createProject(request: APIRequestContext, name: string): Promise<ProjectDTO> {
  const res = await request.post("/api/v1/projects", {
    headers: { origin, "Idempotency-Key": randomUUID() },
    data: { name, key: "M" + randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase() },
  });
  expect(res.status()).toBe(201);
  return SuccessResponseSchema(ProjectSchema).parse(await res.json()).data;
}

/** 直接写入 ProjectMember 行（模拟既有成员，绕过邀请流程；id/joinedAt 用 DB 默认）。 */
async function addMemberDb(projectId: string, userId: string): Promise<void> {
  await withTestDb((client) =>
    client
      .query('INSERT INTO "ProjectMember" ("projectId","userId") VALUES ($1::uuid,$2)', [
        projectId,
        userId,
      ])
      .then(() => undefined),
  );
}

/** 回收本用例创建的用户及其从属数据（子 → 父）。 */
async function cleanupEmails(emails: string[]): Promise<void> {
  await cleanupTestEmails(emails);
}

/**
 * 派生一名新用户并返回其独立浏览器上下文/页面 + userId（姓名改为可辨识值）。
 * 用独立 APIRequestContext 建立会话，避免与 owner 的 request 串 cookie。
 */
async function spawnUser(
  playwright: PlaywrightWorkerArgs["playwright"],
  browser: Browser,
  baseURL: string,
  name: string,
): Promise<{ userId: string; context: BrowserContext; page: Page }> {
  const reqCtx = await playwright.request.newContext({ baseURL });
  const meta: { email?: string } = {};
  const cookies = await establishSessionCookies(reqCtx, baseURL, meta);
  await reqCtx.dispose();
  const email = meta.email!;
  createdEmails.push(email);
  const userId = await withTestDb(async (client) => {
    await client.query('UPDATE "User" SET name=$1 WHERE email=$2', [name, email]);
    const res = await client.query('SELECT id FROM "User" WHERE email=$1', [email]);
    return (res.rows[0] as { id: string }).id;
  });
  const context = await browser.newContext();
  extraContexts.push(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  return { userId, context, page };
}

test.beforeEach(async ({ request, context, baseURL }) => {
  extraContexts = [];
  createdEmails = [];
  const metaA: { email?: string } = {};
  const cookiesA = await establishSessionCookies(request, baseURL!, metaA);
  createdEmails.push(metaA.email!);
  await context.addCookies(cookiesA);
  project = await createProject(request, "M4 成员管理项目");
});

test.afterEach(async () => {
  for (const ctx of extraContexts) {
    await ctx.close().catch(() => {});
  }
  extraContexts = [];
  await cleanupEmails(createdEmails);
  createdEmails = [];
});

test("owner 移除成员：列表移除 + 被移除者失去访问权（UI 与 API 双证）", async ({
  page,
  request,
  browser,
  baseURL,
  playwright,
}) => {
  test.setTimeout(300_000);

  // 派生成员 B 并直接写入成员关系。
  const nameB = "被移除成员 B";
  const memberB = await spawnUser(playwright, browser, baseURL!, nameB);
  await addMemberDb(project.id, memberB.userId);

  // owner 打开成员页：共 2 名成员，A（你/所有者）+ B（成员）。
  await page.goto(`/app/projects/${project.id}/members`);
  await expect(page.getByRole("heading", { name: "项目成员", exact: true })).toBeVisible();
  await expect(page.getByText(/共 2 名成员/)).toBeVisible();
  const rowA = page.getByRole("listitem").filter({ hasText: "（你）" });
  await expect(rowA.getByText("所有者", { exact: true })).toBeVisible();
  const rowB = page.getByRole("listitem").filter({ hasText: nameB });
  await expect(rowB.getByText("成员", { exact: true })).toBeVisible();

  // owner 移除 B：行内「移除」→ 确认对话框 → 确认移除。
  await rowB.getByRole("button", { name: "移除", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "移除成员" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "确认移除", exact: true }).click();

  // 刷新后 B 从列表消失，仅剩 owner。
  await expect(page.getByText(/共 1 名成员/)).toBeVisible();
  await expect(page.getByText(nameB, { exact: true })).toHaveCount(0);

  // 服务端权威复核：成员 API 仅剩 owner。
  const membersRes = await request.get(`/api/v1/projects/${project.id}/members`);
  expect(membersRes.status()).toBe(200);
  const members: MemberDTO[] = MemberListSuccess.parse(await membersRes.json()).data;
  expect(members).toHaveLength(1);
  expect(members.some((m) => m.userId === memberB.userId)).toBe(false);

  // 被移除者 B 失去访问权：项目页落到 notFound UI，成员 API 返回 404。
  await memberB.page.goto(`/app/projects/${project.id}/members`);
  await expect(memberB.page.getByText("无法访问此页面", { exact: true })).toBeVisible();
  const bApi = await memberB.context.request.get(`/api/v1/projects/${project.id}/members`);
  expect(bApi.status()).toBe(404);
});

test("成员自我退出：确认后跳转项目列表且不再是成员", async ({
  page,
  request,
  browser,
  baseURL,
  playwright,
}) => {
  test.setTimeout(300_000);

  const nameC = "自退成员 C";
  const memberC = await spawnUser(playwright, browser, baseURL!, nameC);
  await addMemberDb(project.id, memberC.userId);

  // C 打开成员页：自己那行有「退出项目」入口（非 owner 的本人）。
  await memberC.page.goto(`/app/projects/${project.id}/members`);
  await expect(memberC.page.getByText(/共 2 名成员/)).toBeVisible();
  const rowC = memberC.page.getByRole("listitem").filter({ hasText: nameC });
  await expect(rowC.getByText("（你）", { exact: true })).toBeVisible();

  await rowC.getByRole("button", { name: "退出项目", exact: true }).click();
  const dialog = memberC.page.getByRole("dialog", { name: "退出项目" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "确认退出", exact: true }).click();

  // 退出后硬跳转项目列表，离开本项目。
  await expect(memberC.page).toHaveURL(/\/app\/projects$/);

  // owner 侧复核：成员列表仅剩 owner。
  await page.goto(`/app/projects/${project.id}/members`);
  await expect(page.getByText(/共 1 名成员/)).toBeVisible();
  await expect(page.getByText(nameC, { exact: true })).toHaveCount(0);

  // 退出者 C 不再是成员：成员 API 404。
  const cApi = await memberC.context.request.get(`/api/v1/projects/${project.id}/members`);
  expect(cApi.status()).toBe(404);
  // owner 仍可访问（对照）。
  expect((await request.get(`/api/v1/projects/${project.id}/members`)).status()).toBe(200);
});
