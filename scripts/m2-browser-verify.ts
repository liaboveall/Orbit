/**
 * M2 前端纵向闭环 headless 浏览器验证脚本 —— 修复后「无 reload」版本（截图证据）。
 *
 * 背景：此前 src/features/projects/project-list-client.tsx 与
 * src/features/tasks/real/task-list-client.tsx 用 useState 镜像 Server Component 首屏
 * props，router.refresh() 后客户端 state 不重同步，写操作后同页 UI 停在旧数据，且
 * task.version 陈旧导致同页第二次 PATCH 假 409 VERSION_CONFLICT。旧版脚本因此被迫在
 * 每次写操作后 page.reload() 再断言（掩盖了真实交互行为）。
 *
 * 缺陷已修复：列表组件以 props 为唯一数据真源（仅「加载更多」维护 extra* 追加片段，
 * base props 变化时渲染期丢弃），写操作成功后 `await router.refresh()` 让新 props 流入、
 * 同页即时更新。本脚本 accordingly **移除全部 reload 妥协**，在同一个页面停留内验证：
 *  - 创建项目 → 卡片同页立即出现（不 reload）；
 *  - 创建任务 → 任务行同页立即出现（不 reload）；
 *  - 改状态「进行中」→ Select 同页显示新值（不 reload）；
 *  - 紧接着再改「已完成」→ PATCH 必须 200（而非陈旧 version 引发的假 409）（不 reload）；
 *  - 软删除 → 行同页消失（不 reload）；
 *  - 回收站恢复 → 回收站同页更新为空态（不 reload）。
 *
 * 技术要点：refresh 是异步的，交互后不用 reload，而用 waitForResponse（捕获 API 状态码）
 * + 元素级 waitFor / 短轮询（等待新 props 渲染出的 DOM）来断言同页更新。
 *
 * 复用 m1-e2e-verify.ts 已验证的经验：
 *  - Mailpit 过滤端点 /api/v1/search?query=to:{email}（参数名 query，数组字段 .messages）；
 *  - 验证链接的 HTML 实体 &amp; 需还原为 &；
 *  - hydration 时序：等 React 挂载（form 上出现 __reactProps$ 键）后再交互，
 *    提交成功态用 waitFor（不用 isVisible，后者不自动等待）；
 *  - dev-only 的 StateSwitcher 浮层（aria-label="M0 样例六态切换"）会遮挡，移除之。
 *
 * 运行：先确保 `pnpm dev`（端口 3000）已运行，再 `npx tsx scripts/m2-browser-verify.ts`。
 * 只读验证：不修改任何源代码（src/**），不停止 dev server。
 * 数据隔离：使用全新邮箱 m2fix-{timestamp}@orbit.test 与随机项目 key BFIX***，
 * 避免与旧版脚本（m2shot-*）产生的数据冲突。
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = "http://localhost:3000";
const MAILPIT_API = "http://localhost:8025/api/v1";
const ARTIFACTS = join(process.cwd(), "artifacts", "m2-browser");

const stamp = Date.now();
const EMAIL = `m2fix-${stamp}@orbit.test`;
const PASSWORD = "M2-Orbit-Fix-2026!"; // ≥12 位
const USER_NAME = "无reload验证用户";
const PROJECT_NAME = "无reload验证项目";
/** 项目 key：大写，2—8 位、字母开头；随机后缀避免与既有数据冲突（BFIX+3 位 = 7 位）。 */
const PROJECT_KEY = `BFIX${Math.floor(100 + Math.random() * 900)}`;
const TASK_TITLE = "无reload验证任务";

type StepResult = {
  step: number;
  name: string;
  status: "PASS" | "FAIL";
  detail: string;
  screenshot?: string;
};
const results: StepResult[] = [];
const screenshots: string[] = [];
/** 全程监听到的任务写操作 API 响应（PATCH/DELETE /api/v1/tasks*、POST restore）。 */
const taskApiCalls: Array<{ method: string; url: string; status: number }> = [];

function record(step: number, name: string, status: "PASS" | "FAIL", detail: string): void {
  results.push({ step, name, status, detail });
  console.log(`[${status}] 步骤 ${step} · ${name} — ${detail}`);
}

async function shot(page: Page, name: string): Promise<string> {
  const file = join(ARTIFACTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push(file);
  console.log(`  📸 ${file}`);
  // 关联到最近一条结果记录（若存在）。
  const last = results[results.length - 1];
  if (last && !last.screenshot) last.screenshot = file;
  return file;
}

/** 移除 dev-only 的「M0 样例六态切换」浮层（fixed 定位，可能遮挡点击区）。 */
async function removeDevOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector('[aria-label="M0 样例六态切换"]')?.remove();
  });
}

/**
 * 轮询 Mailpit 直到出现发给指定地址的邮件，返回 { id, html, text }。
 * 过滤端点参数名是 query（非 q），列表数组字段是 .messages（非 .items）。
 */
async function waitForVerificationMail(
  email: string,
  timeoutMs = 25_000,
): Promise<{ id: string; html: string; text: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  while (Date.now() < deadline) {
    const listRes = await fetch(
      `${MAILPIT_API}/search?query=${encodeURIComponent(`to:${email}`)}&limit=5`,
    );
    if (listRes.ok) {
      const list = (await listRes.json()) as {
        messages_count?: number;
        messages?: Array<{ ID: string }>;
      };
      const messages = list.messages ?? [];
      if (messages.length > 0) {
        const id = messages[0]!.ID;
        const msgRes = await fetch(`${MAILPIT_API}/message/${id}`);
        const msg = (await msgRes.json()) as { HTML?: string; Text?: string };
        return { id, html: msg.HTML ?? "", text: msg.Text ?? "" };
      }
      lastCount = list.messages_count ?? 0;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`等待验证邮件超时（${timeoutMs}ms，last messages_count=${lastCount}）`);
}

/** 从邮件正文提取 /api/auth/verify-email 验证链接（HTML 优先，纯文本兜底）。 */
function extractVerifyLink(html: string, text: string): string {
  // HTML 实体还原：&amp; → &，否则 callbackURL 带字面量 &amp; 会失效。
  const decode = (s: string): string =>
    s.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
  const re = /(?:https?:\/\/[^\s"'<>]+)?\/api\/auth\/verify-email\?token=[^\s"'<>&]+[^\s"'<>]*/g;
  const fromHtml = decode(html).match(re);
  if (fromHtml && fromHtml.length > 0) return fromHtml[0]!;
  const fromText = decode(text).match(re);
  if (fromText && fromText.length > 0) return fromText[0]!;
  throw new Error(`邮件中未找到验证链接。HTML 片段：${html.slice(0, 400)}`);
}

/**
 * 等待 React 完成 hydration：检测页面 form 元素上是否已挂载 React 事件 props。
 * SSR HTML 先到、JS 后挂载；不等这一步，提交点击会被原生表单吞掉（无 POST）。
 * 若当前页无 form，退化为等待一小段时间。
 */
async function waitForHydration(page: Page, timeoutMs = 20_000): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const forms = Array.from(document.querySelectorAll("form"));
        if (forms.length === 0) return false;
        return forms.every((form) =>
          Object.keys(form).some((key) => key.startsWith("__reactProps$")),
        );
      },
      undefined,
      { timeout: timeoutMs },
    )
    .catch(() => undefined);
  await page.waitForTimeout(300);
}

/**
 * 短轮询等待行内状态 Select 的可见文本匹配期望（refresh 异步，新 props 渲染需要时间；
 * **绝不 reload**——reload 会掩盖同页更新缺陷）。返回最后观察到的文本（用于失败诊断）。
 */
async function waitForStatusText(
  page: Page,
  expected: RegExp,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = (
      await page
        .getByRole("combobox", { name: /的状态/ })
        .first()
        .innerText()
        .catch(() => "")
    ).trim();
    if (expected.test(last)) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  return last;
}

/** 短轮询等待「某文本从页面消失」（软删除后行同页消失 / 恢复后回收站行同页消失）。 */
async function waitForTextGone(page: Page, text: string, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const visible = await page
      .getByText(text)
      .first()
      .isVisible()
      .catch(() => false);
    if (!visible) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main(): Promise<void> {
  mkdirSync(ARTIFACTS, { recursive: true });
  const browser: Browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  // 收紧默认超时，避免单步卡死拖垮整体运行。
  page.setDefaultTimeout(15_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  // 全程监听任务写操作响应：PATCH /api/v1/tasks/{id}（状态）、DELETE（软删除）、
  // POST /api/v1/tasks/{id}/restore（恢复）。步骤 9 的核心断言（200 而非假 409）据此判定。
  page.on("response", (res) => {
    const url = res.url();
    const method = res.request().method();
    if (!url.includes("/api/v1/tasks")) return;
    if (method === "PATCH" || method === "DELETE" || (method === "POST" && url.includes("/restore"))) {
      taskApiCalls.push({ method, url, status: res.status() });
      console.log(`  🌐 ${method} ${url.replace(BASE_URL, "")} → ${res.status()}`);
    }
  });

  let projectId: string | null = null;
  let taskId: string | null = null;
  let taskIdentifier: string | null = null;
  /** 状态列 Select 触发器：aria-label 形如「任务 {identifier} 的状态」（pending 时带「（更新中）」）。 */
  const statusTrigger = () =>
    taskIdentifier
      ? page.getByRole("combobox", { name: new RegExp(`任务 ${taskIdentifier} 的状态`) })
      : page.getByRole("combobox", { name: /的状态/ }).first();

  /* ── 步骤 1：注册 ─────────────────────────────────────────────────── */
  try {
    await page.goto(`${BASE_URL}/auth/register`, { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await page.getByLabel("姓名").fill(USER_NAME);
    await page.getByLabel("邮箱").fill(EMAIL);
    await page.getByLabel("密码", { exact: true }).fill(PASSWORD);
    await page.getByLabel("确认密码").fill(PASSWORD);
    const registerButton = page.getByRole("button", { name: "注册" });
    await registerButton.click();
    const sentHeading = page.getByText("验证邮件已发送");
    try {
      await sentHeading.waitFor({ timeout: 15_000 });
    } catch {
      // 首次点击可能早于 React 事件挂载 → 原生表单自刷新，重填重试一次。
      console.log("  ⚠️ 首次提交后未见成功态，重填并重试一次…");
      await waitForHydration(page);
      await page.getByLabel("姓名").fill(USER_NAME);
      await page.getByLabel("邮箱").fill(EMAIL);
      await page.getByLabel("密码", { exact: true }).fill(PASSWORD);
      await page.getByLabel("确认密码").fill(PASSWORD);
      await registerButton.click();
      await sentHeading.waitFor({ timeout: 15_000 });
    }
    record(1, "注册", "PASS", `已注册 ${EMAIL}，进入「验证邮件已发送」态`);
    await shot(page, "fix-01-register");
  } catch (error) {
    record(1, "注册", "FAIL", String(error));
    await shot(page, "fix-01-register").catch(() => undefined);
  }

  /* ── 步骤 2：邮箱验证 ─────────────────────────────────────────────── */
  try {
    const mail = await waitForVerificationMail(EMAIL);
    const rawLink = extractVerifyLink(mail.html, mail.text);
    const link = rawLink.startsWith("http") ? rawLink : `${BASE_URL}${rawLink}`;
    await page.goto(link, { waitUntil: "domcontentloaded" });
    await page.getByText("邮箱验证成功").waitFor({ timeout: 20_000 });
    record(2, "邮箱验证", "PASS", `message id=${mail.id}，验证成功页已展示`);
    await shot(page, "fix-02-verify");
  } catch (error) {
    record(2, "邮箱验证", "FAIL", String(error));
    await shot(page, "fix-02-verify").catch(() => undefined);
  }

  /* ── 步骤 3：登录（如未自动登录）──────────────────────────────────── */
  try {
    // 验证后可能已自动登录：直接访问受保护页，若被重定向到登录页则显式登录。
    await page.goto(`${BASE_URL}/app/projects`, { waitUntil: "domcontentloaded" });
    if (/\/auth\/login/.test(page.url())) {
      await waitForHydration(page);
      await page.getByLabel("邮箱").fill(EMAIL);
      await page.getByLabel("密码", { exact: true }).fill(PASSWORD);
      await page.getByRole("button", { name: "登录" }).click();
      await page.waitForURL(/\/app\//, { timeout: 20_000 });
      record(3, "登录", "PASS", `未自动登录，显式登录后 URL=${page.url()}`);
    } else {
      record(3, "登录", "PASS", `验证后已自动登录，URL=${page.url()}`);
    }
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await shot(page, "fix-03-logged-in");
  } catch (error) {
    record(3, "登录", "FAIL", String(error));
    await shot(page, "fix-03-logged-in").catch(() => undefined);
  }

  /* ── 步骤 4：项目列表空态 ─────────────────────────────────────────── */
  try {
    await page.goto(`${BASE_URL}/app/projects`, { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await removeDevOverlay(page);
    // 全新邮箱注册用户，项目列表必须是空态。
    const emptyVisible = await page
      .getByText("还没有项目")
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    record(
      4,
      "项目列表空态",
      emptyVisible ? "PASS" : "FAIL",
      `空态「还没有项目」可见=${emptyVisible}（新用户应无项目）`,
    );
    await shot(page, "fix-04-projects-empty");
  } catch (error) {
    record(4, "项目列表空态", "FAIL", String(error));
    await shot(page, "fix-04-projects-empty").catch(() => undefined);
  }

  /* ── 步骤 5：创建项目（不 reload，卡片须同页立即出现）──────────────── */
  try {
    // 空态按钮「创建第一个项目」或页头「新建项目」均可展开表单。
    const emptyAction = page.getByRole("button", { name: "创建第一个项目" });
    const headerAction = page.getByRole("button", { name: "新建项目" });
    if (await emptyAction.isVisible().catch(() => false)) {
      await emptyAction.click();
    } else {
      await headerAction.first().click();
    }
    await page.getByLabel("项目名称").waitFor({ timeout: 10_000 });
    await page.getByLabel("项目名称").fill(PROJECT_NAME);
    await page.getByLabel("项目标识").fill(PROJECT_KEY);
    // 标记色：Radix Select，点击展开后选一个非默认项（青）以证明可交互。
    const colorTrigger = page.getByRole("combobox", { name: "项目标记色" });
    await colorTrigger.click();
    await page.getByRole("option", { name: "青" }).first().click();
    await page.getByRole("button", { name: "创建项目" }).click();
    await page.getByText("项目已创建").first().waitFor({ timeout: 15_000 });
    // ★ 修复验证点：**不 reload**。onCreated 里 await router.refresh() 会让 Server
    // Component 重读列表并以新 props 重渲染本页，项目卡片应同页立即出现。
    await page.getByRole("button", { name: PROJECT_NAME }).first().waitFor({ timeout: 15_000 });
    // 通过 API 取 projectId（供后续直达 tasks/trash 页，避免依赖点击卡片）。
    projectId = await page
      .evaluate(async (key) => {
        const res = await fetch("/api/v1/projects?limit=100");
        const json = (await res.json()) as { data?: Array<{ id?: string; key?: string }> };
        return json.data?.find((p) => p.key === key)?.id ?? null;
      }, PROJECT_KEY)
      .catch(() => null);
    record(
      5,
      "创建项目（无 reload）",
      "PASS",
      `已创建「${PROJECT_NAME}」（key=${PROJECT_KEY}），toast 后卡片**同页立即出现**（未 reload），projectId=${projectId}`,
    );
    await shot(page, "fix-05-project-created-noreload");
  } catch (error) {
    record(5, "创建项目（无 reload）", "FAIL", String(error));
    await shot(page, "fix-05-project-created-noreload").catch(() => undefined);
  }

  /* ── 步骤 6：进入项目任务列表（空态）──────────────────────────────── */
  try {
    if (!projectId) throw new Error("缺少 projectId（步骤 5 未取到），无法进入任务页");
    // 优先点击项目卡片（整卡为 button）；失败则直达 tasks URL。
    const card = page.getByRole("button", { name: PROJECT_NAME }).first();
    if (await card.isVisible().catch(() => false)) {
      await card.click();
    } else {
      await page.goto(`${BASE_URL}/app/projects/${projectId}/tasks`, {
        waitUntil: "domcontentloaded",
      });
    }
    await page.waitForURL(/\/app\/projects\/[^/]+\/tasks/, { timeout: 15_000 });
    const m = page.url().match(/\/app\/projects\/([^/]+)\/tasks/);
    if (m && m[1]) projectId = m[1];
    await waitForHydration(page);
    await removeDevOverlay(page);
    const emptyVisible = await page
      .getByText("还没有任务")
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    record(
      6,
      "任务列表空态",
      emptyVisible ? "PASS" : "FAIL",
      `URL=${page.url()}，projectId=${projectId}，空态「还没有任务」可见=${emptyVisible}`,
    );
    await shot(page, "fix-06-tasks-empty");
  } catch (error) {
    record(6, "任务列表空态", "FAIL", String(error));
    await shot(page, "fix-06-tasks-empty").catch(() => undefined);
  }

  /* ── 步骤 7：创建任务（不 reload，任务行须同页立即出现）────────────── */
  try {
    await page.getByRole("button", { name: "新建任务" }).first().click();
    await page.getByLabel("任务标题").waitFor({ timeout: 10_000 });
    await page.getByLabel("任务标题").fill(TASK_TITLE);
    await page.getByRole("button", { name: "创建任务" }).click();
    await page.getByText("任务已创建").first().waitFor({ timeout: 15_000 });
    // ★ 修复验证点：**不 reload**，等待 refresh 后新 props 渲染出的任务行同页出现。
    const taskRow = page.getByText(TASK_TITLE).first();
    await taskRow.waitFor({ timeout: 15_000 });
    // 从 API 取 taskId/identifier（后续状态切换的响应断言与 aria-label 定位需要）。
    const taskInfo = await page
      .evaluate(
        async ({ pid, title }: { pid: string; title: string }) => {
          const res = await fetch(`/api/v1/projects/${pid}/tasks?limit=10`);
          const json = (await res.json()) as {
            data?: Array<{ id?: string; identifier?: string; title?: string }>;
          };
          const t = json.data?.find((x) => x.title === title);
          return t ? { id: t.id ?? null, identifier: t.identifier ?? null } : null;
        },
        { pid: projectId as string, title: TASK_TITLE },
      )
      .catch(() => null);
    if (taskInfo) {
      taskId = taskInfo.id;
      taskIdentifier = taskInfo.identifier;
    }
    if (!taskIdentifier) {
      // 兜底：从表格行的 mono 单元格读取 identifier。
      taskIdentifier = await page
        .locator("tbody th .font-mono")
        .first()
        .textContent()
        .then((t) => t?.trim() ?? null)
        .catch(() => null);
    }
    record(
      7,
      "创建任务（无 reload）",
      "PASS",
      `任务「${TASK_TITLE}」已创建，toast 后任务行**同页立即出现**（未 reload），id=${taskId}，identifier=${taskIdentifier}`,
    );
    await shot(page, "fix-07-task-created-noreload");
  } catch (error) {
    record(7, "创建任务（无 reload）", "FAIL", String(error));
    await shot(page, "fix-07-task-created-noreload").catch(() => undefined);
  }

  /* ── 步骤 8：改状态「进行中」（不 reload，Select 须同页显示新值）───── */
  let patch1Status: number | null = null;
  try {
    if (!taskId) throw new Error("缺少 taskId（步骤 7 未取到），无法切换状态");
    // 同时等待 PATCH 响应与同页 UI 更新（不 reload）。
    const patchPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/v1/tasks/${taskId}`) && res.request().method() === "PATCH",
      { timeout: 15_000 },
    );
    await statusTrigger().first().click();
    await page.getByRole("option", { name: "进行中" }).first().click();
    patch1Status = (await patchPromise).status();
    // ★ 修复验证点：refresh 后新 props（status=IN_PROGRESS）流入，Select 同页显示「进行中」。
    const shown = await waitForStatusText(page, /进行中/);
    // 服务端真值交叉验证（只读 GET，不是 reload）。
    const serverStatus = await page
      .evaluate(async (tid) => {
        const res = await fetch(`/api/v1/tasks/${tid}`);
        const json = (await res.json()) as { data?: { status?: string; version?: number } };
        return json.data?.status ?? null;
      }, taskId)
      .catch(() => null);
    const ok = patch1Status === 200 && /进行中/.test(shown) && serverStatus === "IN_PROGRESS";
    record(
      8,
      "改状态·进行中（无 reload）",
      ok ? "PASS" : "FAIL",
      `PATCH → ${patch1Status}（期望 200），Select 同页显示「${shown}」，服务端 status=${serverStatus}，全程未 reload`,
    );
    await shot(page, "fix-08-status-inprogress");
  } catch (error) {
    record(8, "改状态·进行中（无 reload）", "FAIL", `${String(error)}（PATCH 状态=${patch1Status}）`);
    await shot(page, "fix-08-status-inprogress").catch(() => undefined);
  }

  /* ── 步骤 9：紧接着改「已完成」（核心：PATCH 须 200 而非假 409）────── */
  let patch2Status: number | null = null;
  try {
    if (!taskId) throw new Error("缺少 taskId（步骤 7 未取到），无法切换状态");
    // ★★ 核心验证点：与步骤 8 之间**零 reload、零导航**，同一页面停留内立即再次写。
    // 修复前：useState 镜像里的 task.version 陈旧 → 第二次 PATCH 必 409 VERSION_CONFLICT。
    // 修复后：refresh 已带入新 version → 第二次 PATCH 应 200。
    const patchPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/v1/tasks/${taskId}`) && res.request().method() === "PATCH",
      { timeout: 15_000 },
    );
    await statusTrigger().first().click();
    await page.getByRole("option", { name: "已完成" }).first().click();
    patch2Status = (await patchPromise).status();
    const shown = await waitForStatusText(page, /已完成/);
    const serverStatus = await page
      .evaluate(async (tid) => {
        const res = await fetch(`/api/v1/tasks/${tid}`);
        const json = (await res.json()) as { data?: { status?: string } };
        return json.data?.status ?? null;
      }, taskId)
      .catch(() => null);
    const noConflictToast = !(await page
      .getByText("任务已被其他人更新")
      .first()
      .isVisible()
      .catch(() => false));
    const ok = patch2Status === 200 && /已完成/.test(shown) && serverStatus === "DONE" && noConflictToast;
    record(
      9,
      "连续改状态·已完成（无 reload，假 409 核心验证）",
      ok ? "PASS" : "FAIL",
      `第二次 PATCH → ${patch2Status}（必须 200，修复前为假 409），Select 同页显示「${shown}」，服务端 status=${serverStatus}，冲突 toast 未出现=${noConflictToast}，全程未 reload`,
    );
    await shot(page, "fix-08b-status-done-no409");
  } catch (error) {
    record(
      9,
      "连续改状态·已完成（无 reload，假 409 核心验证）",
      "FAIL",
      `${String(error)}（第二次 PATCH 状态=${patch2Status}，若非 200 说明假 409 未修复）`,
    );
    await shot(page, "fix-08b-status-done-no409").catch(() => undefined);
  }

  /* ── 步骤 10：回收站确认删除的任务前置——软删除（不 reload，行须同页消失） */
  let deleteStatus: number | null = null;
  try {
    const delTrigger = taskIdentifier
      ? page.getByRole("button", { name: `删除任务 ${taskIdentifier}` })
      : page.getByRole("button", { name: /删除任务/ }).first();
    const deletePromise = page
      .waitForResponse(
        (res) => res.url().includes("/api/v1/tasks/") && res.request().method() === "DELETE",
        { timeout: 15_000 },
      )
      .catch(() => null);
    await delTrigger.first().click();
    await page.getByRole("heading", { name: "删除任务" }).waitFor({ timeout: 8_000 });
    await page.getByRole("button", { name: "移入回收站" }).click();
    await page.getByText("任务已移入回收站").first().waitFor({ timeout: 15_000 });
    deleteStatus = (await deletePromise)?.status() ?? null;
    // ★ 修复验证点：**不 reload**，refresh 后新 props（不含已删任务）流入，行同页消失。
    const gone = await waitForTextGone(page, TASK_TITLE);
    record(
      10,
      "软删除（无 reload）",
      gone ? "PASS" : "FAIL",
      `DELETE → ${deleteStatus}，toast「任务已移入回收站」后任务行**同页消失**=${gone}（未 reload）`,
    );
    await shot(page, "fix-10-deleted-noreload");
  } catch (error) {
    record(10, "软删除（无 reload）", "FAIL", `${String(error)}（DELETE 状态=${deleteStatus}）`);
    await shot(page, "fix-10-deleted-noreload").catch(() => undefined);
  }

  /* ── 步骤 11：回收站 → 恢复（不 reload，回收站须同页更新为空态）────── */
  try {
    await page.goto(`${BASE_URL}/app/projects/${projectId}/trash`, {
      waitUntil: "domcontentloaded",
    });
    await waitForHydration(page);
    await removeDevOverlay(page);
    const inTrash = await page
      .getByText(TASK_TITLE)
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!inTrash) throw new Error("回收站中未见已删除任务，无法继续恢复验证");
    await shot(page, "fix-11-trash-before-restore");

    const restoreBtn = taskIdentifier
      ? page.getByRole("button", { name: `恢复 ${taskIdentifier}` })
      : page.getByRole("button", { name: /^恢复 / }).first();
    const restorePromise = page
      .waitForResponse(
        (res) => res.url().includes("/restore") && res.request().method() === "POST",
        { timeout: 15_000 },
      )
      .catch(() => null);
    await restoreBtn.first().click();
    await page.getByText("任务已恢复").first().waitFor({ timeout: 15_000 });
    const restoreStatus = (await restorePromise)?.status() ?? null;
    // ★ 修复验证点：**不 reload、不导航离开回收站**，refresh 后回收站同页更新：
    // 行消失 + 空态「回收站为空」出现 + 计数归零。
    const goneFromTrash = await waitForTextGone(page, TASK_TITLE);
    const emptyTrash = await page
      .getByText("回收站为空")
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    const countZero = await page
      .getByText(/共 0 条/)
      .first()
      .isVisible()
      .catch(() => false);
    const ok = goneFromTrash && emptyTrash && restoreStatus === 200;
    record(
      11,
      "回收站恢复（无 reload）",
      ok ? "PASS" : "FAIL",
      `POST restore → ${restoreStatus}，任务行同页消失=${goneFromTrash}，空态「回收站为空」同页出现=${emptyTrash}，计数「共 0 条」=${countZero}，全程停留在回收站页未 reload`,
    );
    await shot(page, "fix-12-restored-noreload");
  } catch (error) {
    record(11, "回收站恢复（无 reload）", "FAIL", String(error));
    await shot(page, "fix-12-restored-noreload").catch(() => undefined);
  }

  /* ── 汇总 ─────────────────────────────────────────────────────────── */
  await browser.close();

  console.log("\n===== M2 浏览器纵向闭环验证结果（修复后 · 无 reload 版）=====");
  for (const r of results) {
    console.log(`步骤 ${String(r.step).padStart(2, "0")} [${r.status}] ${r.name} — ${r.detail}`);
  }
  const failed = results.filter((r) => r.status === "FAIL");
  const overallPass = failed.length === 0 && results.length === 11;
  const patchCalls = taskApiCalls.filter((c) => c.method === "PATCH");
  const anyPatch409 = patchCalls.some((c) => c.status === 409);
  console.log(
    `\nOverall: ${overallPass ? "PASS ✅" : "FAIL ❌"}（${results.length - failed.length}/${results.length} 步通过）`,
  );
  console.log(
    `假 409 判定：全程 PATCH /api/v1/tasks 共 ${patchCalls.length} 次，状态码=[${patchCalls
      .map((c) => c.status)
      .join(", ")}]，出现 409=${anyPatch409 ? "是 ❌（修复不彻底）" : "否 ✅"}`,
  );
  console.log("\n任务写操作 API 调用全记录：");
  for (const c of taskApiCalls) {
    console.log(`  ${c.method} ${c.url.replace(BASE_URL, "")} → ${c.status}`);
  }
  if (pageErrors.length > 0) {
    console.log(`\n浏览器 pageerror（${pageErrors.length} 条）:`);
    for (const e of pageErrors) console.log(`  - ${e}`);
  }
  console.log(`\n截图（${screenshots.length} 张）:`);
  for (const s of screenshots) console.log(`  - ${s}`);

  writeFileSync(
    join(ARTIFACTS, "fix-summary.json"),
    JSON.stringify(
      {
        overall: overallPass ? "PASS" : "FAIL",
        mode: "no-reload（验证 props 唯一真源修复后的同页即时更新）",
        email: EMAIL,
        projectKey: PROJECT_KEY,
        projectId,
        taskId,
        taskIdentifier,
        patchStatuses: { first: patch1Status, secondConsecutive: patch2Status },
        anyPatch409,
        taskApiCalls,
        results,
        screenshots,
        pageErrors,
      },
      null,
      2,
    ),
    "utf8",
  );
  process.exitCode = overallPass ? 0 : 1;
}

main().catch((error) => {
  console.error("脚本致命错误：", error);
  process.exitCode = 1;
});
