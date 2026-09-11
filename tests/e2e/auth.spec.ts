import { expect, test, type APIRequestContext } from "@playwright/test";
import dotenv from "dotenv";
import { cleanupTestEmails } from "./support/db";

/**
 * 认证全流程 E2E（M1 / ORB-005，含复核回归）。
 *
 * 覆盖 docs/07 T-AUTH 的真实浏览器路径：
 *  - proxy 门禁：未登录访问 /app/* 重定向到 /auth/login?returnTo=<编码路径>（防开放重定向的相对路径）。
 *  - 登录失败：展示统一文案「邮箱或密码不正确」，不泄露账户是否存在。
 *  - 主流程：注册 → 从 Mailpit 取验证链接 → 验证（autoSignIn 建会话）→ 进入 /app/today。
 *
 * 运行前置（详见 tests/README.md）：
 *  - 首次需安装浏览器：`pnpm exec playwright install --with-deps chromium`。
 *  - 主流程依赖本地 Mailpit（默认 http://localhost:8025，可用 MAILPIT_API 覆盖）读取验证邮件；
 *    Mailpit 不可达时主流程失败，避免验收跳过真实邮件流程。
 *  - 应用需连接可写数据库（DATABASE_URL）且 SMTP 指向 Mailpit（.env.local 默认已配）。
 *  - 说明：/app/* 由 proxy.ts session cookie 门禁 + app/app/layout.tsx getSessionUser 双层保护；
 *    主流程验证后 autoSignIn 已建会话，proxy 放行，故 URL 停在 /app/today 即断言通过；
 *    today/board/task 工作台内容仍为 fixture 样例（M2 替换为真实数据）。
 *  - E2E 会在测试库中创建唯一邮箱（e2e-<ts>@orbit.test）的用户；afterAll 通过
 *    tests/e2e/support/db.ts 的共享助手按该邮箱精确清理（A10：不在测试库里累积
 *    永久不回收的历史夹具）。
 */

dotenv.config({ path: [".env.local", ".env"], quiet: true });

const MAILPIT_API = process.env.MAILPIT_API ?? "http://localhost:8025/api/v1";
const RUN = `e2e-${Date.now()}`;
const EMAIL = `${RUN}@orbit.test`;
const NAME = "端到端用户";
const PASSWORD = "Str0ng!Passw0rd-E2E"; // ≥12 位，满足密码策略

/** Mailpit 是否可达（beforeAll 用 Node 全局 fetch 探测；request fixture 仅测试作用域可用）。 */
let mailpitReady = false;

/** 当前测试文件创建的邮箱列表（用于 beforeAll 前置清理）。 */
const createdEmails: string[] = [];

// 在每个 spec 运行前，先清理本文件中之前运行可能留下的残留数据（累积效应修复）
test.beforeAll(async ({}) => {
  try {
    const res = await fetch(`${MAILPIT_API}/messages?limit=1`);
    mailpitReady = res.ok;
  } catch {
    mailpitReady = false;
  }
  
  // 如果之前有残留邮箱，先尝试清理
  if (createdEmails.length > 0) {
    const result = await cleanupTestEmails(createdEmails);
    console.log(`[auth beforeAll] 清理前置残留：${createdEmails.length}个邮箱，cleanedCount=${result.cleanedCount}${result.error ? ` (${result.error})` : ''}`);
  }
});

test.afterAll(async () => {
  // 只有「注册 → 邮箱验证 → …」用例会真正创建这个邮箱对应的用户；其余用例（未登录
  // 重定向、登录失败、伪造 cookie）都不注册账户。无论如何都尝试清理，因为
  // cleanupTestEmails 对不存在的邮箱是安全的空操作（先查询再删除，查无用户即返回）。
  const result = await cleanupTestEmails([EMAIL]);
  console.log(
    `[auth] 已清理本轮 E2E 数据：email=${EMAIL}, ` +
      `清理计数=${JSON.stringify(result.cleanedCount)}${result.error ? ` (error: ${result.error})` : ''}`,
  );
  

});

/** 轮询 Mailpit，取精确发往 to、主题含 subjectPart 的最新邮件正文（text+html）。 */
async function fetchMailBody(
  request: APIRequestContext,
  to: string,
  subjectPart: string,
  timeoutMs = 15000,
): Promise<string> {
  const target = to.toLowerCase();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request.get(`${MAILPIT_API}/messages`, {
      params: { query: `to:${to}`, limit: "100" },
    });
    if (res.ok()) {
      const json = (await res.json()) as {
        messages?: { ID: string; Subject: string; To: { Address: string }[] }[];
      };
      // Mailpit `to:` 为分词模糊匹配：必须按精确收件人地址复核（避免命中同前缀的其它邮件）。
      const hit = (json.messages ?? []).find(
        (m) =>
          m.Subject.includes(subjectPart) &&
          m.To.some((a) => a.Address.toLowerCase() === target),
      );
      if (hit) {
        const full = await request.get(`${MAILPIT_API}/message/${hit.ID}`);
        const body = (await full.json()) as { Text?: string; HTML?: string };
        return `${body.Text ?? ""}\n${body.HTML ?? ""}`;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`超时未从 Mailpit 取到发往 ${to} 且主题含「${subjectPart}」的邮件`);
}

/** 从邮件正文提取 `token=` 值（验证/重置链接共用）。 */
function extractToken(body: string): string {
  const match = /[?&]token=([^&\s"'<>]+)/.exec(body);
  if (!match?.[1]) throw new Error("未能从邮件正文提取 token");
  return decodeURIComponent(match[1]);
}

test("未登录访问 /app/today 被 proxy 重定向到 /auth/login 并携带 returnTo", async ({ page }) => {
  await page.goto("/app/today");
  await expect(page).toHaveURL(/\/auth\/login\?returnTo=%2Fapp%2Ftoday/);
  // 登录页正常渲染（邮箱字段可见）。
  await expect(page.getByLabel("邮箱")).toBeVisible();
});

test("登录失败展示统一文案，不泄露账户是否存在", async ({ page }) => {
  await page.goto("/auth/login");
  await page.getByLabel("邮箱").fill(`${RUN}-nobody@orbit.test`);
  await page.getByLabel("密码", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  // 统一文案：不区分「账户不存在」与「密码错误」。
  await expect(page.getByText("邮箱或密码不正确")).toBeVisible();
});

test.use({ timezoneId: "America/New_York" });

test("注册 → 邮箱验证 → 浏览器时区 → 重设密码后原浏览器重新登录", async ({ page, request }) => {
  expect(mailpitReady, "M1 验收需要本地 Mailpit").toBe(true);
  test.setTimeout(60000);

  // 记录创建的邮箱（用于前置清理）
  createdEmails.push(EMAIL);

  // 1) 注册
  await page.goto("/auth/register");
  await page.getByLabel("姓名").fill(NAME);
  await page.getByLabel("邮箱").fill(EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(PASSWORD);
  await page.getByLabel("确认密码").fill(PASSWORD);
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page.getByRole("heading", { name: "验证邮件已发送" })).toBeVisible();

  // 2) 从 Mailpit 取真实验证邮件，提取 token，重建同源验证链接（避免 localhost/127.0.0.1 主机差异）
  const mailBody = await fetchMailBody(request, EMAIL, "验证你的 Orbit 邮箱");
  expect(mailBody).toContain("Orbit");
  expect(mailBody).not.toContain(PASSWORD); // 邮件不含密码明文
  const token = extractToken(mailBody);
  const verifyUrl = `/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent("/auth/verify")}`;

  // 3) 点击验证链接：GET /api/auth/verify-email → 校验 token、置 emailVerified、autoSignIn 建会话 → 重定向 /auth/verify
  await page.goto(verifyUrl);
  await expect(page).toHaveURL(/\/auth\/verify/);
  await expect(page.getByRole("heading", { name: "邮箱验证成功" })).toBeVisible();

  // 4) 进入应用（已有会话，proxy 放行 /app/today）
  await page.getByRole("button", { name: "进入 Orbit" }).click();
  await expect(page).toHaveURL(/\/app\/today/);
  const profile = await (await page.request.get("/api/v1/me")).json();
  expect(profile.data.timezone).toBe("America/New_York");
  const origin = new URL(page.url()).origin;
  expect((await page.request.patch("/api/v1/me", { headers: { origin }, data: { timezone: "Asia/Tokyo" } })).status()).toBe(200);
  // 保存真实 Cookie，重设后验证服务端撤销；不将凭证写入报告。
  const cookies = await page.context().cookies();
  await page.goto("/auth/forgot-password");
  await page.getByLabel("邮箱", { exact: true }).fill(EMAIL);
  await page.getByRole("button", { name: "发送重置邮件", exact: true }).click();
  await expect(page.getByRole("heading", { name: "检查你的邮箱" })).toBeVisible();
  const resetToken = extractToken(await fetchMailBody(request, EMAIL, "重设"));
  await page.goto(`/auth/reset-password?token=${encodeURIComponent(resetToken)}`);
  const nextPassword = "New-Str0ng!Passw0rd-E2E";
  await page.getByLabel("新密码", { exact: true }).fill(nextPassword);
  await page.getByLabel("确认新密码", { exact: true }).fill(nextPassword);
  await page.getByRole("button", { name: "重设密码", exact: true }).click();
  await expect(page.getByRole("heading", { name: "密码已重设", exact: true })).toBeVisible();
  await page.context().addCookies(cookies);
  expect((await page.request.get("/api/v1/me")).status()).toBe(401);
  await page.goto("/app/settings?tab=profile");
  await expect(page.getByLabel("邮箱", { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/app/settings?tab=profile");
  await page.getByLabel("邮箱", { exact: true }).fill(EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(nextPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings\?tab=profile/);
  expect((await (await page.request.get("/api/v1/me")).json()).data.timezone).toBe("Asia/Tokyo");
});


test("伪造或失效 Cookie 可重新登录，并保留原访问地址", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "better-auth.session_token", value: "invalid-session.signature", url: baseURL! }]);
  await page.goto("/app/settings?tab=profile");
  await expect(page.getByLabel("邮箱")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/app/settings?tab=profile");
  await page.goto("/auth/register");
  await expect(page.getByLabel("确认密码")).toBeVisible();
  expect((await context.request.get("/api/v1/me")).status()).toBe(401);
});
