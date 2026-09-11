/**
 * M1 浏览器 E2E 全流程验证脚本（Task #18 Part 2）。
 *
 * 覆盖 Flow A–E：
 *  A 注册 → Mailpit 取验证邮件 → 邮箱验证 → 登录 → 进入 /app
 *  B 个人设置：初值 → 修改 name/timezone → 保存 → toast → reload 持久化（AC-1）
 *  C 非法时区 PATCH /api/v1/me → 400 + fieldErrors.timezone，页面值不变
 *  D UserMenu 退出 → /auth/login；再访问 /app/settings 被重定向
 *  E 键盘可访问性：Tab 遍历焦点环 + 时区 combobox 纯键盘操作
 *
 * 运行：先 `pnpm dev`（端口 3000），再 `npx tsx scripts/m1-e2e-verify.ts`。
 * 截图输出：artifacts/m1-e2e/。只读验证，不修改任何源代码。
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = "http://localhost:3000";
const MAILPIT_API = "http://localhost:8025/api/v1";
const ARTIFACTS = join(process.cwd(), "artifacts", "m1-e2e");

const stamp = Date.now();
const EMAIL = `e2e-m1-${stamp}@orbit.test`;
const PASSWORD = "E2E-Orbit-Pass-2026!";
const INITIAL_NAME = "E2E初始用户";
const NEW_NAME = "E2E测试用户";
const NEW_TZ = "America/New_York";

type FlowResult = { flow: string; step: string; status: "PASS" | "FAIL"; detail: string };
const results: FlowResult[] = [];
const screenshots: string[] = [];

function record(flow: string, step: string, status: "PASS" | "FAIL", detail: string): void {
  results.push({ flow, step, status, detail });
  console.log(`[${status}] ${flow} · ${step} — ${detail}`);
}

async function shot(page: Page, name: string): Promise<void> {
  const file = join(ARTIFACTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  screenshots.push(file);
  console.log(`  📸 ${file}`);
}

/**
 * 轮询 Mailpit 直到出现发给指定地址的邮件，返回 { id, html, text }。
 * 注意：Mailpit 的过滤端点是 `/api/v1/search?query=…`（参数名是 query 非 q），
 * 且列表响应的数组字段是 `.messages`（非 `.items`）——已用实际 API 验证。
 */
async function waitForVerificationMail(
  email: string,
  timeoutMs = 20_000,
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
  // 先把 HTML 实体还原（&amp; → &），否则 callbackURL 会带着字面量 &amp; 发给服务端而失效。
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
 * 等待 React 完成 hydration：检测 form 元素上是否已挂载 React 事件 props
 * （React 19 会在 DOM 节点上留 `__reactProps$…` 键）。SSR HTML 先到、JS 后挂载，
 * 不等这一步会导致提交点击被原生表单吞掉（无 action → 页面自刷新，无 POST）。
 */
async function waitForHydration(page: Page, timeoutMs = 20_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const forms = Array.from(document.querySelectorAll("form"));
      return (
        forms.length > 0 &&
        forms.every((form) => Object.keys(form).some((key) => key.startsWith("__reactProps$")))
      );
    },
    undefined,
    { timeout: timeoutMs },
  );
  await page.waitForTimeout(300);
}

async function main(): Promise<void> {
  mkdirSync(ARTIFACTS, { recursive: true });
  const browser: Browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  /* ── Flow A：注册 → 邮件验证 → 登录 ───────────────────────────────── */
  try {
    await page.goto(`${BASE_URL}/auth/register`, { waitUntil: "domcontentloaded" });
    await waitForHydration(page);

    // 预检：React 受控输入是否生效（输入后密码强度条应出现，纯 SSR 则不会）。
    const pwd = page.getByLabel("密码", { exact: true });
    await pwd.fill("probe1234567");
    const strengthVisible = await page
      .getByText(/个字符|强度|弱|中|强/)
      .first()
      .isVisible({ timeout: 4_000 })
      .catch(() => false);
    const emailValueProbe = await page.getByLabel("邮箱").inputValue();
    record(
      "A",
      "hydration 预检",
      "PASS",
      `密码强度提示可见=${strengthVisible}（false 也不直接判 FAIL，后续交互为准）；邮箱初值="${emailValueProbe}"`,
    );

    await page.getByLabel("姓名").fill(INITIAL_NAME);
    await page.getByLabel("邮箱").fill(EMAIL);
    await pwd.fill(PASSWORD);
    await page.getByLabel("确认密码").fill(PASSWORD);
    await shot(page, "00-register-filled");
    const registerButton = page.getByRole("button", { name: "注册" });
    await registerButton.click();
    // 提交后等待成功态。isVisible() 不自动等待，必须用 waitFor；
    // 若首次点击早于 React 事件挂载导致原生表单自刷新（仍在注册页），重填重试一次。
    const sentHeading = page.getByText("验证邮件已发送");
    try {
      await sentHeading.waitFor({ timeout: 15_000 });
    } catch {
      console.log("  ⚠️ 首次提交后未见成功态，重填并重试一次…");
      await waitForHydration(page);
      await page.getByLabel("姓名").fill(INITIAL_NAME);
      await page.getByLabel("邮箱").fill(EMAIL);
      await page.getByLabel("密码", { exact: true }).fill(PASSWORD);
      await page.getByLabel("确认密码").fill(PASSWORD);
      await registerButton.click();
      await sentHeading.waitFor({ timeout: 15_000 });
    }
    record("A", "注册提交", "PASS", `已注册 ${EMAIL}，进入「验证邮件已发送」态`);

    const mail = await waitForVerificationMail(EMAIL);
    const rawLink = extractVerifyLink(mail.html, mail.text);
    // 邮件里的链接可能是相对路径（/api/auth/verify-email?…），补全为绝对 URL。
    const link = rawLink.startsWith("http") ? rawLink : `${BASE_URL}${rawLink}`;
    record("A", "Mailpit 取验证邮件", "PASS", `message id=${mail.id}，链接=${link.slice(0, 90)}…`);

    await page.goto(link, { waitUntil: "domcontentloaded" });
    await page.getByText("邮箱验证成功").waitFor({ timeout: 20_000 });
    record("A", "邮箱验证", "PASS", "验证链接访问后展示「邮箱验证成功」");
    await shot(page, "01-verify-success");

    // 验证后库可能已自动登录；为保证步骤 7「从 /auth/login 登录」是真实登录，先清会话。
    await context.clearCookies();

    await page.goto(`${BASE_URL}/auth/login`, { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await page.getByLabel("邮箱").fill(EMAIL);
    await page.getByLabel("密码", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL(/\/app\//, { timeout: 20_000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    record("A", "登录重定向", "PASS", `登录后 URL=${page.url()}`);
    await shot(page, "02-login-success-app");
  } catch (error) {
    record("A", "流程异常", "FAIL", String(error));
    await shot(page, "FAIL-flow-a").catch(() => undefined);
  }

  /* ── Flow B：个人设置（修改 + 持久化）───────────────────────────────── */
  try {
    await page.goto(`${BASE_URL}/app/settings`, { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    const nameInput = page.getByRole("textbox", { name: "姓名" });
    const tzCombobox = page.getByRole("combobox", { name: "时区" });
    await nameInput.waitFor({ timeout: 15_000 });

    const initialName = await nameInput.inputValue();
    const initialTz = await tzCombobox.inputValue();
    if (initialName !== INITIAL_NAME) {
      throw new Error(`设置页姓名初值不符：期望 "${INITIAL_NAME}"，实际 "${initialName}"`);
    }
    record("B", "初始状态", "PASS", `name="${initialName}"，timezone 显示="${initialTz}"`);
    await shot(page, "03-settings-initial");

    // 修改姓名
    await nameInput.fill(NEW_NAME);
    // 修改时区：自定义 combobox —— 点击打开 → 输入过滤 → 点选匹配项。
    // 注意：combobox 收起后显示的是**本地化标签**（如「纽约」）而非 IANA id，
    // 故此处只校验标签相对初值发生变化，持久化的权威值随后用 GET /api/v1/me 核对。
    await tzCombobox.click();
    await tzCombobox.fill("New_York");
    const option = page
      .getByRole("option")
      .filter({ hasText: NEW_TZ })
      .first();
    await option.waitFor({ timeout: 5_000 });
    await option.click();
    const tzAfterPick = await tzCombobox.inputValue();
    if (!tzAfterPick || tzAfterPick === initialTz) {
      throw new Error(`时区选择后输入框标签未变化，实际 "${tzAfterPick}"（初值 "${initialTz}"）`);
    }

    const saveButton = page.getByRole("button", { name: "保存更改" });
    await saveButton.click();
    // 成功反馈：toast「设置已保存」 + 状态文案回到「所有更改已保存」
    await page.getByText("设置已保存").first().waitFor({ timeout: 15_000 });
    await page.getByText("所有更改已保存").first().waitFor({ timeout: 10_000 });
    record("B", "保存成功反馈", "PASS", `toast「设置已保存」出现，timezone 标签="${tzAfterPick}"`);
    await shot(page, "04-settings-saved-toast");

    // 权威校验：GET /api/v1/me 返回的 timezone/name 应为新值（不依赖前端标签）。
    const savedMe = await page.evaluate(async () => {
      const res = await fetch("/api/v1/me");
      const json = (await res.json()) as { data?: { name?: string; timezone?: string } };
      return { status: res.status, name: json.data?.name, timezone: json.data?.timezone };
    });
    if (savedMe.status !== 200 || savedMe.name !== NEW_NAME || savedMe.timezone !== NEW_TZ) {
      throw new Error(
        `GET /me 未反映保存结果：status=${savedMe.status}，name=${savedMe.name}，timezone=${savedMe.timezone}`,
      );
    }
    record("B", "服务端持久化(GET /me)", "PASS", `name=${savedMe.name}，timezone=${savedMe.timezone}`);

    // AC-1 持久化：刷新后姓名输入框仍是新值、时区标签仍为新时区（非初值）
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await nameInput.waitFor({ timeout: 15_000 });
    const nameAfterReload = await nameInput.inputValue();
    const tzAfterReload = await tzCombobox.inputValue();
    if (nameAfterReload !== NEW_NAME) {
      throw new Error(`reload 后姓名未持久化：实际 "${nameAfterReload}"`);
    }
    if (!tzAfterReload || tzAfterReload === initialTz) {
      throw new Error(`reload 后时区未持久化：实际 "${tzAfterReload}"（初值 "${initialTz}"）`);
    }
    record("B", "AC-1 reload 持久化", "PASS", `name="${nameAfterReload}"，timezone 标签="${tzAfterReload}"`);
    await shot(page, "05-settings-after-reload");
  } catch (error) {
    record("B", "流程异常", "FAIL", String(error));
    await shot(page, "FAIL-flow-b").catch(() => undefined);
  }

  /* ── Flow C：非法时区拒绝（API 级别）────────────────────────────────── */
  try {
    const apiResult = await page.evaluate(async () => {
      const res = await fetch("/api/v1/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: "Invalid/Zone" }),
      });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        /* 保留原文 */
      }
      return { status: res.status, body: body ?? text.slice(0, 500) };
    });
    const body = apiResult.body as {
      error?: { code?: string; fieldErrors?: Record<string, string[]> };
    };
    const tzFieldErrors = body?.error?.fieldErrors?.timezone;
    if (apiResult.status !== 400 || !tzFieldErrors || tzFieldErrors.length === 0) {
      throw new Error(
        `期望 400 + fieldErrors.timezone，实际 status=${apiResult.status}，body=${JSON.stringify(apiResult.body).slice(0, 300)}`,
      );
    }
    record(
      "C",
      "非法时区 400",
      "PASS",
      `status=400，code=${body?.error?.code}，fieldErrors.timezone[0]=${tzFieldErrors[0]}`,
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    // 非法提交被拒后，服务端时区应仍为 Flow B 保存的 America/New_York（用 GET /me 权威核对）。
    const tzAfterReject = await page.evaluate(async () => {
      const res = await fetch("/api/v1/me");
      const json = (await res.json()) as { data?: { timezone?: string } };
      return json.data?.timezone;
    });
    if (tzAfterReject !== NEW_TZ) {
      throw new Error(`非法提交后时区被意外修改：实际 "${tzAfterReject}"，期望 "${NEW_TZ}"`);
    }
    record("C", "页面时区未变", "PASS", `reload 后 GET /me timezone 仍为 "${tzAfterReject}"`);
    await shot(page, "06-invalid-tz-rejected");
  } catch (error) {
    record("C", "流程异常", "FAIL", String(error));
    await shot(page, "FAIL-flow-c").catch(() => undefined);
  }

  /* ── Flow D：退出 + 缓存隔离 ───────────────────────────────────────── */
  try {
    // Flow C 末尾 reload 过页面，Radix 菜单需要 React 挂载后才能点开
    await waitForHydration(page);
    // 移除 dev-only 的「M0 样例六态切换」浮层（fixed 左下角，会遮挡侧栏底部的账户菜单）。
    // 该面板与被测退出功能无关，仅为开发脚手架，测试环境中移除以暴露真实点击区。
    await page.evaluate(() => {
      document.querySelector('[aria-label="M0 样例六态切换"]')?.remove();
    });
    // 通过 UserMenu 退出（settings 变体：IconButton label=账户菜单）
    const menuTrigger = page.getByRole("button", { name: "账户菜单", exact: true });
    await menuTrigger.first().click();
    const logoutItem = page.getByRole("menuitem", { name: /退出登录/ });
    await logoutItem.waitFor({ timeout: 5_000 });
    await logoutItem.click();
    await page.waitForURL(/\/auth\/login/, { timeout: 20_000 });
    record("D", "UserMenu 退出", "PASS", `退出后 URL=${page.url()}`);

    // 未认证直接访问 /app/settings 应被重定向回登录页
    const protectedRes = await page.goto(`${BASE_URL}/app/settings`, {
      waitUntil: "domcontentloaded",
    });
    const finalUrl = page.url();
    const redirectStatus = protectedRes?.status();
    if (!/\/auth\/login/.test(finalUrl)) {
      throw new Error(`访问 /app/settings 未被重定向：最终 URL=${finalUrl}，status=${redirectStatus}`);
    }
    record(
      "D",
      "受保护路由重定向",
      "PASS",
      `/app/settings → ${finalUrl}（导航响应 status=${redirectStatus}，重定向链由服务端 3xx 完成）`,
    );
    await shot(page, "07-logged-out-login");
  } catch (error) {
    record("D", "流程异常", "FAIL", String(error));
    await shot(page, "FAIL-flow-d").catch(() => undefined);
  }

  /* ── Flow E：键盘可访问性 ──────────────────────────────────────────── */
  try {
    // 重新登录以进入设置页
    await page.goto(`${BASE_URL}/auth/login`, { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await page.getByLabel("邮箱").fill(EMAIL);
    await page.getByLabel("密码", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL(/\/app\//, { timeout: 20_000 });
    await page.goto(`${BASE_URL}/app/settings`, { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    // 同 Flow D：移除 dev-only 浮层，避免它进入 Tab 焦点序列干扰键盘遍历审计。
    await page.evaluate(() => {
      document.querySelector('[aria-label="M0 样例六态切换"]')?.remove();
    });
    const nameInput = page.getByRole("textbox", { name: "姓名" });
    await nameInput.waitFor({ timeout: 15_000 });

    // Tab 遍历：从姓名输入框开始，逐一检查焦点环（outline 可见）。
    // 只判定**应用交互控件**（input/button/a[href]/select/[role=combobox]/[tabindex]）；
    // Next.js dev 浮层（nextjs-portal）、body/html 等非控件不参与判定（开发工具产物，非被测键盘流）。
    await nameInput.focus();
    type FocusInfo = {
      el: string;
      outline: string;
      visible: boolean;
      isControl: boolean;
    };
    const focusAudit: FocusInfo[] = [];
    const skipped: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const info = await page.evaluate((): FocusInfo | null => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const tag = el.tagName.toLowerCase();
        const inDevPortal = Boolean(el.closest("nextjs-portal, [data-nextjs-dialog], #__next-build-watcher"));
        const interactive =
          tag === "input" ||
          tag === "button" ||
          tag === "select" ||
          tag === "textarea" ||
          (tag === "a" && el.hasAttribute("href")) ||
          el.getAttribute("role") === "combobox" ||
          el.getAttribute("role") === "menuitem";
        const isControl = interactive && !inDevPortal && tag !== "body" && tag !== "html";
        const style = window.getComputedStyle(el);
        const label =
          el.getAttribute("aria-label") ?? (el.getAttribute("name") || "") ?? tag;
        return {
          el: `${tag}[${label}]`,
          outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
          visible: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0,
          isControl,
        };
      });
      if (info) {
        if (info.isControl) focusAudit.push(info);
        else skipped.push(info.el);
      }
      await shot(page, `08-focus-step-${i + 1}`);
      await page.keyboard.press("Tab");
    }
    const controls = focusAudit;
    const allVisible = controls.length > 0 && controls.every((f) => f.visible);
    record(
      "E",
      "Tab 焦点环",
      allVisible ? "PASS" : "FAIL",
      `应用控件 ${controls.length} 个均焦点环可见=${allVisible}：` +
        controls.map((f) => `${f.el}:${f.visible ? "可见" : "不可见"}(${f.outline})`).join(" | ") +
        (skipped.length > 0 ? ` ‖ 已跳过非控件/dev浮层：${skipped.join(", ")}` : ""),
    );

    // 时区 combobox 纯键盘操作：聚焦 → ArrowDown 打开 → 输入过滤 → ArrowDown 移动 → Escape 关闭
    const tzCombobox = page.getByRole("combobox", { name: "时区" });
    await tzCombobox.focus();
    await page.keyboard.press("ArrowDown");
    const expandedAfterArrow = await tzCombobox.getAttribute("aria-expanded");
    await page.keyboard.type("Tokyo");
    const typedValue = await tzCombobox.inputValue();
    const tokyoOptionVisible = await page
      .getByRole("option")
      .filter({ hasText: "Tokyo" })
      .first()
      .isVisible({ timeout: 3_000 });
    const activeDescendant = await tzCombobox.getAttribute("aria-activedescendant");
    await shot(page, "09-tz-combobox-keyboard-open");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    const expandedAfterEscape = await tzCombobox.getAttribute("aria-expanded");
    const keyboardOk =
      expandedAfterArrow === "true" &&
      typedValue === "Tokyo" &&
      tokyoOptionVisible &&
      activeDescendant !== null &&
      expandedAfterEscape === "false";
    record(
      "E",
      "combobox 键盘操作",
      keyboardOk ? "PASS" : "FAIL",
      `ArrowDown 展开=${expandedAfterArrow}，输入过滤="${typedValue}"，Tokyo 选项可见=${tokyoOptionVisible}，activedescendant=${activeDescendant}，Escape 关闭=${expandedAfterEscape}`,
    );
    await shot(page, "10-keyboard-focus-final");
  } catch (error) {
    record("E", "流程异常", "FAIL", String(error));
    await shot(page, "FAIL-flow-e").catch(() => undefined);
  }

  /* ── 汇总 ─────────────────────────────────────────────────────────── */
  await browser.close();

  console.log("\n========== M1 E2E 验证结果汇总 ==========");
  const flows = ["A", "B", "C", "D", "E"];
  let overallPass = true;
  for (const flow of flows) {
    const items = results.filter((r) => r.flow === flow);
    const failed = items.filter((r) => r.status === "FAIL");
    const status = items.length > 0 && failed.length === 0 ? "PASS" : "FAIL";
    if (status === "FAIL") overallPass = false;
    console.log(`Flow ${flow}: ${status}（${items.length - failed.length}/${items.length} 步通过）`);
  }
  console.log(`\nOverall: ${overallPass ? "PASS ✅" : "FAIL ❌"}`);
  if (pageErrors.length > 0) {
    console.log(`\n浏览器 pageerror（${pageErrors.length} 条）:`);
    for (const e of pageErrors) console.log(`  - ${e}`);
  }
  console.log(`\n截图（${screenshots.length} 张）:`);
  for (const s of screenshots) console.log(`  - ${s}`);

  writeFileSync(
    join(ARTIFACTS, "summary.json"),
    JSON.stringify({ overall: overallPass ? "PASS" : "FAIL", results, screenshots, pageErrors }, null, 2),
    "utf8",
  );
  process.exitCode = overallPass ? 0 : 1;
}

main().catch((error) => {
  console.error("脚本致命错误：", error);
  process.exitCode = 1;
});
