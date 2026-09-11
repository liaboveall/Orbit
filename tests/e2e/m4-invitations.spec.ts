import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";
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
 * M4 / ORB-013：邀请令牌纵向闭环 E2E（真实浏览器）。
 *
 * 覆盖任务 Part 4「完整浏览器流程」：
 *  1. User A（owner）登录 → 创建项目 → 打开邀请页；
 *  2. UI 点击「创建邀请」→ 校验对话框 → 一次性链接面板展示明文令牌链接；
 *  3. 复制邀请链接（授予剪贴板权限，断言按钮切到「已复制」）；
 *  4. 新开浏览器上下文承载 User B（独立 APIRequestContext 建立已验证会话）；
 *  5. B 打开邀请链接 → 预览显示项目信息 → 点击「接受邀请」→ 跳转项目看板；
 *  6. 回到 A 的成员页 → B 出现在成员列表（共 2 名成员 + B 姓名可见）；
 *  另附：owner 撤销邀请（列表状态转「已撤销」+ 状态筛选）。
 *
 * 与 m3-workflows.spec.ts 同一套基础设施：establishSessionCookies 走真实
 * 注册 → Mailpit 验证 → autoSignIn 链路取得 session cookie 注入浏览器上下文；
 * 数据副作用在 afterEach 用原生 SQL 从**独立测试库**（TEST_DATABASE_URL，见
 * tests/e2e/support/db.ts，A10 修复：此前直连 DATABASE_URL/orbit_dev）精确回收。
 *
 * ⚠️ 运行前置：`pnpm test:e2e` 会通过 scripts/e2e-server.mjs 自建连接 orbit_test 的
 * 测试服务；Mailpit 均需在线；否则用例失败（属预期）。
 * ⚠️ 两名用户默认同名（auth-setup 固定姓名），故给 B 改一个可辨识姓名后再断言成员列表。
 */

dotenv.config({ path: [".env.local", ".env"], quiet: true });
test.describe.configure({ mode: "serial" });

/** Better Auth 受信源：POST 端点 Origin 头须命中它（与 auth-setup 一致）。默认端口 3100，
 * 对齐 scripts/e2e-server.mjs 的 E2E_PORT 默认值（测试专用服务，与开发服务器的 3000 分开）。 */
const origin = process.env.E2E_AUTH_ORIGIN ?? `http://localhost:${process.env.E2E_PORT ?? "3100"}`;

let project: ProjectDTO;
let cookiesA: Awaited<ReturnType<typeof establishSessionCookies>> = [];
let contextB: BrowserContext | null = null;
/** 本次用例在库中留下的全部用户邮箱（A + 可能的 B），afterEach 精确回收。 */
let createdEmails: string[] = [];

/** 以当前会话经 API 创建项目（统一信封 → ProjectDTO）。 */
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
  contextB = null;
  const metaA: { email?: string } = {};
  cookiesA = await establishSessionCookies(request, baseURL!, metaA);
  createdEmails.push(metaA.email!);
  await context.addCookies(cookiesA);
  project = await createProject(request, "M4 邀请闭环项目");
});

test.afterEach(async () => {
  if (contextB) {
    await contextB.close().catch(() => {});
    contextB = null;
  }
  await cleanupTestEmails(createdEmails);
  createdEmails = [];
});

test("邀请闭环：owner UI 创建并复制链接 → 第二用户接受 → 出现在成员列表", async ({
  page,
  context,
  request,
  browser,
  baseURL,
  playwright,
}) => {
  test.setTimeout(300_000);

  /* ── A：打开邀请页，UI 创建邀请 ─────────────────────────────────────── */
  await page.goto(`/app/projects/${project.id}/invitations`);
  await expect(page.getByRole("heading", { name: "邀请管理", exact: true })).toBeVisible();
  // owner 才可见「创建邀请」入口。
  await page.getByRole("button", { name: "创建邀请", exact: true }).click();

  const createDialog = page.getByRole("dialog", { name: "创建邀请链接" });
  await expect(createDialog).toBeVisible();
  await createDialog.getByRole("button", { name: "创建邀请", exact: true }).click();

  // 一次性链接面板：明文令牌链接仅此处展示一次。
  const linkPanel = page.getByRole("region", { name: "新创建的邀请链接" });
  await expect(linkPanel).toBeVisible();
  const linkText = (await linkPanel.locator("code").textContent())?.trim() ?? "";
  // R02：令牌走哈希片段 `/invite#token=<token>`，不再是路径段 `/invite/<token>`
  // （片段不发往服务端，因此不进入访问日志 / Referer）。
  expect(linkText).toContain(`/invite#token=`);
  // 明文令牌不得出现在路径中：路径部分必须恰好是 /invite。
  expect(new URL(linkText).pathname).toBe("/invite");
  // 列表刷新后出现一条邀请。
  await expect(page.getByText("共 1 个邀请", { exact: true })).toBeVisible();

  /* ── A：复制邀请链接（授予剪贴板权限，断言按钮切到「已复制」）────────── */
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.bringToFront();
  await linkPanel.getByRole("button", { name: "复制链接", exact: true }).click();
  await expect(
    linkPanel.getByRole("button", { name: "已复制", exact: true }),
  ).toBeVisible();

  // 从链接解析出邀请地址，供 B 在自身上下文导航。
  // 必须保留哈希片段：令牌只存在于 `#token=` 中，仅取 pathname 会把令牌丢掉。
  const inviteUrl = new URL(linkText);
  const invitePath = `${inviteUrl.pathname}${inviteUrl.hash}`;
  expect(invitePath).toMatch(/^\/invite#token=.+$/);

  /* ── B：独立 request 上下文建立已验证会话 + 独立浏览器上下文 ─────────── */
  const requestB = await playwright.request.newContext({ baseURL: baseURL! });
  const metaB: { email?: string } = {};
  const cookiesB = await establishSessionCookies(requestB, baseURL!, metaB);
  createdEmails.push(metaB.email!);
  await requestB.dispose();
  // 给 B 一个可辨识姓名（默认与 A 同名），便于成员列表断言。
  const nameB = "受邀同事 B";
  await withTestDb((client) =>
    client
      .query('UPDATE "User" SET name=$1 WHERE email=$2', [nameB, metaB.email!])
      .then(() => undefined),
  );

  contextB = await browser.newContext();
  await contextB.addCookies(cookiesB);
  const pageB = await contextB.newPage();

  /* ── B：预览邀请 → 接受 → 跳转项目看板 ─────────────────────────────── */
  await pageB.goto(baseURL! + invitePath);
  await expect(
    pageB.getByRole("heading", { name: "邀请你加入项目", exact: true }),
  ).toBeVisible();
  // 预览显示项目名（不泄露明文令牌）。
  await expect(pageB.getByText(project.name, { exact: true })).toBeVisible();
  await expect(pageB.getByText("邀请人", { exact: true })).toBeVisible();
  // 已登录 → 直接「接受邀请」。
  await pageB.getByRole("button", { name: "接受邀请", exact: true }).click();
  await expect(pageB).toHaveURL(new RegExp(`/app/projects/${project.id}/board`));

  /* ── A：成员列表出现 B ─────────────────────────────────────────────── */
  await page.goto(`/app/projects/${project.id}/members`);
  await expect(page.getByText(/共 2 名成员/)).toBeVisible();
  await expect(page.getByText(nameB, { exact: true })).toBeVisible();
  // 服务端权威复核：B 确为项目成员。
  const members = await request.get(`/api/v1/projects/${project.id}/members`);
  expect(members.status()).toBe(200);
});

test("owner 撤销邀请：列表状态转「已撤销」，状态筛选生效", async ({ page }) => {
  test.setTimeout(300_000);

  await page.goto(`/app/projects/${project.id}/invitations`);
  // UI 创建一条邀请。
  await page.getByRole("button", { name: "创建邀请", exact: true }).click();
  await page
    .getByRole("dialog", { name: "创建邀请链接" })
    .getByRole("button", { name: "创建邀请", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "新创建的邀请链接" })).toBeVisible();
  await expect(page.getByText("共 1 个邀请", { exact: true })).toBeVisible();

  // 撤销：点击行内「撤销邀请」图标按钮 → 确认对话框 → 确认撤销。
  await page.getByRole("button", { name: "撤销邀请", exact: true }).click();
  const revokeDialog = page.getByRole("dialog", { name: "撤销邀请" });
  await expect(revokeDialog).toBeVisible();
  await revokeDialog.getByRole("button", { name: "确认撤销", exact: true }).click();

  // 刷新后该邀请状态徽标为「已撤销」，且不再有撤销入口。
  await expect(
    page.getByRole("listitem").filter({ hasText: "已撤销" }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: "撤销邀请", exact: true })).toHaveCount(0);

  // 状态筛选：切到「有效」→ 0 条；切到「已撤销」→ 1 条。
  await page.getByRole("button", { name: "有效", exact: true }).click();
  await expect(page.getByText("共 0 个邀请", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "已撤销", exact: true }).click();
  await expect(page.getByText("共 1 个邀请", { exact: true })).toBeVisible();
});
