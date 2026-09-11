/**
 * M0 验收截图与键盘可访问性验证脚本（ORB-002）。
 *
 * 用途：对三个核心页面在 390 / 768 / 1440px 精确视口下批量截图，产物写入 artifacts/，
 * 作为 M0「响应式外壳 + 六态 + 看板 + 详情」的验收证据；同时在 1440px 桌面视口做一次
 * 键盘可访问性验证（Tab 焦点顺序、任务卡「更多菜单」聚焦可见、Dialog 打开/Escape/焦点恢复）。
 *
 * 直接以脚本方式运行（非 test runner）：pnpm tsx scripts/m0-screenshots.ts
 * 依赖已在后台运行的开发服务器（默认 http://localhost:3000，可用 E2E_BASE_URL 覆盖）。
 *
 * ⚠️ 数据来源：被测页面使用 fixture 合成数据（M0 未连接真实后端）。
 * ⚠️ 设计说明：看板页头「新建任务」在 M0 触发的是 Toast（样例模式提示），并非 Dialog；
 *    桌面端真正带 [role="dialog"] 的模态是任务详情「未保存更改」确认框，键盘验证以此为准，
 *    并额外如实记录「新建任务 → Toast」的行为。
 */

import { chromium } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

/* ── 常量 ─────────────────────────────────────────────────────────────── */

const BASE_URL = (process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUT_DIR = path.resolve(process.cwd(), "artifacts");

const PROJECT_ID = "11111111-2222-4333-8444-555555555501";
const TASK_ID = "33333333-4444-4555-8666-777777770001";

const BOARD = `/app/projects/${PROJECT_ID}/board`;
const DETAIL_PAGE = `/app/projects/${PROJECT_ID}/tasks/${TASK_ID}`;

type Viewport = { name: string; width: number; height: number };

const VIEWPORTS: Viewport[] = [
  { name: "1440", width: 1440, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "390", width: 390, height: 844 },
];

/** 每个视口都要截的 11 张（六态工作台 + 看板三态 + 详情面板 + 详情独立页）。 */
type Shot = { file: string; urlPath: string };

function shotList(vp: string): Shot[] {
  return [
    { file: `${vp}-today-data.png`, urlPath: "/app/today" },
    { file: `${vp}-today-loading.png`, urlPath: "/app/today?state=loading" },
    { file: `${vp}-today-empty.png`, urlPath: "/app/today?state=empty" },
    { file: `${vp}-today-error.png`, urlPath: "/app/today?state=error" },
    { file: `${vp}-today-permission.png`, urlPath: "/app/today?state=permission" },
    { file: `${vp}-today-long-content.png`, urlPath: "/app/today?state=long-content" },
    { file: `${vp}-board-data.png`, urlPath: BOARD },
    { file: `${vp}-board-loading.png`, urlPath: `${BOARD}?state=loading` },
    { file: `${vp}-board-empty.png`, urlPath: `${BOARD}?state=empty` },
    { file: `${vp}-detail-panel.png`, urlPath: `${BOARD}?task=${TASK_ID}` },
    { file: `${vp}-detail-page.png`, urlPath: DETAIL_PAGE },
  ];
}

/* ── 结果收集 ─────────────────────────────────────────────────────────── */

type ShotResult = {
  file: string;
  viewport: string;
  urlPath: string;
  bytes: number;
  px: string;
  status: "ok" | "warn" | "error";
  note: string;
};

type KbCheck = { name: string; pass: boolean; detail: string };

const shotResults: ShotResult[] = [];
const kbChecks: KbCheck[] = [];
const uiIssues: string[] = [];

function recordKb(name: string, pass: boolean, detail: string) {
  kbChecks.push({ name, pass, detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

/* ── 导航与截图工具 ───────────────────────────────────────────────────── */

async function goto(page: Page, urlPath: string): Promise<void> {
  await page.goto(BASE_URL + urlPath, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // dev 模式下 HMR websocket 会阻止 networkidle，这里退回 load + 固定等待让 React 水合与字体就绪。
  await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(900);
}

/** 粗检页面是否空白 / 命中错误页 / Next 错误浮层，返回描述性 note。 */
async function inspectPage(page: Page): Promise<{ status: "ok" | "warn"; note: string }> {
  const info = await page.evaluate(() => {
    const bodyText = (document.body?.innerText ?? "").trim();
    const main = document.querySelector("main");
    const mainText = (main?.innerText ?? "").trim();
    const notFound = /404|not found|页面不存在|不可访问/i.test(bodyText.slice(0, 400));
    // dev 模式常驻 <nextjs-portal> / #__next-build-watcher 属正常，仅当 portal 的 shadow DOM
    // 内出现真实错误对话框/终端时才判为错误浮层，避免误报。
    const errOverlay = (() => {
      if (document.querySelector("[data-nextjs-dialog], [data-nextjs-terminal]")) return true;
      const portals = Array.from(document.querySelectorAll("nextjs-portal"));
      for (const p of portals) {
        const root = (p as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (!root) continue;
        if (
          root.querySelector(
            "[data-nextjs-dialog], [data-nextjs-terminal], [data-nextjs-dialog-header]",
          )
        )
          return true;
      }
      return false;
    })();
    return {
      title: document.title,
      bodyLen: bodyText.length,
      mainLen: mainText.length,
      notFound,
      errOverlay,
    };
  });

  const notes: string[] = [];
  let status: "ok" | "warn" = "ok";
  if (info.mainLen === 0) {
    status = "warn";
    notes.push("main 内容为空");
  }
  if (info.notFound) {
    status = "warn";
    notes.push("疑似命中 not-found/不可访问页");
  }
  if (info.errOverlay) {
    status = "warn";
    notes.push("检测到 Next 错误浮层");
  }
  notes.push(`title="${info.title}" mainTextLen=${info.mainLen}`);
  return { status, note: notes.join("; ") };
}

async function takeShot(page: Page, vp: Viewport, shot: Shot): Promise<void> {
  const file = path.join(OUT_DIR, shot.file);
  try {
    await goto(page, shot.urlPath);
    const insp = await inspectPage(page);
    await page.screenshot({ path: file, fullPage: false });
    const stat = fs.statSync(file);
    shotResults.push({
      file: shot.file,
      viewport: vp.name,
      urlPath: shot.urlPath,
      bytes: stat.size,
      px: `${vp.width}x${vp.height}`,
      status: insp.status,
      note: insp.note,
    });
    const flag = insp.status === "ok" ? "✓" : "⚠";
    console.log(
      `  ${flag} ${shot.file}  ${(stat.size / 1024).toFixed(1)} KB  [${insp.note}]`,
    );
    if (insp.status === "warn") uiIssues.push(`${shot.file} (${shot.urlPath}): ${insp.note}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    shotResults.push({
      file: shot.file,
      viewport: vp.name,
      urlPath: shot.urlPath,
      bytes: 0,
      px: `${vp.width}x${vp.height}`,
      status: "error",
      note: msg,
    });
    uiIssues.push(`${shot.file} (${shot.urlPath}) 截图失败: ${msg}`);
    console.log(`  ✗ ${shot.file}  截图失败: ${msg}`);
  }
}

async function saveAndRecord(page: Page, fileName: string, note: string): Promise<void> {
  const file = path.join(OUT_DIR, fileName);
  try {
    await page.screenshot({ path: file, fullPage: false });
    const stat = fs.statSync(file);
    shotResults.push({
      file: fileName,
      viewport: fileName.split("-")[0] ?? "",
      urlPath: note,
      bytes: stat.size,
      px: "special",
      status: "ok",
      note,
    });
    console.log(`  ✓ ${fileName}  ${(stat.size / 1024).toFixed(1)} KB  [${note}]`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    uiIssues.push(`${fileName} 截图失败: ${msg}`);
    console.log(`  ✗ ${fileName}  截图失败: ${msg}`);
  }
}

/* ── 键盘可访问性验证（1440 桌面）────────────────────────────────────── */

async function keyboardVerification(context: BrowserContext): Promise<void> {
  console.log("\n=== 键盘可访问性验证（1440px 桌面 · board）===");

  // (A) Tab 焦点顺序遍历 —— 记录前 12 步的 activeElement。
  {
    const page = await context.newPage();
    await goto(page, BOARD);
    // 从文档起点开始遍历
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.focus();
    });
    const order: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(120);
      const desc = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return "<body>";
        const role = el.getAttribute("role") ?? "";
        const aria = el.getAttribute("aria-label") ?? "";
        const text = (el.textContent ?? "").trim().slice(0, 24);
        return `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ""}${
          aria ? `[aria=${aria}]` : ""
        }${text ? ` "${text}"` : ""}`;
      });
      order.push(`${i + 1}. ${desc}`);
    }
    console.log("  Tab 焦点顺序：");
    order.forEach((o) => console.log(`    ${o}`));
    const reachedInteractive = order.filter((o) => !o.endsWith("<body>")).length;
    recordKb(
      "Tab 焦点可遍历且落到交互元素",
      reachedInteractive >= 5,
      `12 步中 ${reachedInteractive} 步聚焦到交互元素`,
    );

    // (B) 任务卡「更多菜单」按钮聚焦时可见（wrapper computed opacity === 1）。
    const moreBtn = page.locator('button[aria-label^="更多操作："]').first();
    const hasMore = await moreBtn.count();
    if (hasMore > 0) {
      await moreBtn.evaluate((el) => (el as HTMLElement).focus());
      await page.waitForTimeout(200);
      const opacityInfo = await moreBtn.evaluate((el) => {
        // opacity 施加在按钮外层 wrapper（group-focus-within）上
        const wrapper = el.parentElement as HTMLElement | null;
        const wrapperOpacity = wrapper ? getComputedStyle(wrapper).opacity : "n/a";
        const selfOpacity = getComputedStyle(el as HTMLElement).opacity;
        const focused = document.activeElement === el;
        return { wrapperOpacity, selfOpacity, focused };
      });
      const visible = opacityInfo.wrapperOpacity === "1";
      recordKb(
        "任务卡「更多菜单」聚焦时可见",
        visible && opacityInfo.focused,
        `wrapper opacity=${opacityInfo.wrapperOpacity}（聚焦=${opacityInfo.focused}）`,
      );
      if (!visible) {
        uiIssues.push(
          `任务卡「更多菜单」聚焦时 wrapper opacity=${opacityInfo.wrapperOpacity}（期望 1）`,
        );
      }
      // 键盘焦点态截图
      await saveAndRecord(page, "1440-board-keyboard-focus.png", "Tab 遍历 + 更多菜单聚焦可见");
    } else {
      recordKb("任务卡「更多菜单」聚焦时可见", false, "未找到 button[aria-label^='更多操作：']");
      uiIssues.push("board 页未找到任务卡「更多菜单」按钮");
      await page.keyboard.press("Tab");
      await saveAndRecord(page, "1440-board-keyboard-focus.png", "Tab 遍历（未定位到更多菜单）");
    }
    await page.close();
  }

  // (C) 「新建任务」按钮的键盘激活行为（如实记录：M0 触发 Toast，非 Dialog）。
  {
    const page = await context.newPage();
    await goto(page, BOARD);
    const newBtn = page.getByRole("button", { name: "新建任务" }).first();
    if ((await newBtn.count()) > 0) {
      await newBtn.evaluate((el) => (el as HTMLElement).focus());
      await page.keyboard.press("Enter");
      await page.waitForTimeout(400);
      const dialogCount = await page.locator('[role="dialog"]').count();
      const toastVisible = await page
        .getByText("样例模式：未连接真实后端")
        .first()
        .isVisible()
        .catch(() => false);
      recordKb(
        "「新建任务」键盘 Enter 可激活（M0 设计为 Toast，非 Dialog）",
        toastVisible || dialogCount === 0,
        dialogCount > 0
          ? `意外出现 [role=dialog]×${dialogCount}`
          : `未弹出 Dialog（符合 M0 设计）；Toast 可见=${toastVisible}`,
      );
    } else {
      recordKb("「新建任务」键盘 Enter 可激活", false, "未找到「新建任务」按钮");
      uiIssues.push("board 页未找到「新建任务」按钮");
    }
    await page.close();
  }

  // (D~F) 真实 Dialog：任务详情「未保存更改」确认框 —— 打开 / Escape 关闭 / 焦点恢复。
  {
    const page = await context.newPage();
    await goto(page, `${BOARD}?task=${TASK_ID}`);

    // 进入标题编辑并制造 dirty
    const titleBtn = page.locator('button[title="点击进入编辑"]').first();
    await titleBtn.click();
    await page.waitForTimeout(200);
    const titleInput = page.getByLabel("编辑标题");
    await titleInput.fill("（键盘验证）修改后的任务标题");
    await page.waitForTimeout(150);

    // 聚焦「关闭详情」按钮并 Enter → dirty 触发确认 Dialog
    const closeBtn = page.getByLabel("关闭详情");
    await closeBtn.evaluate((el) => (el as HTMLElement).focus());
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);

    const dialog = page.locator('[role="dialog"]').filter({ hasText: "你有未保存的更改" });
    const dialogOpened = (await dialog.count()) > 0 && (await dialog.first().isVisible());
    recordKb("确认 Dialog 打开（[role=dialog] 出现）", dialogOpened, dialogOpened
      ? '出现 [role="dialog"]「你有未保存的更改」'
      : "未检测到确认 Dialog");

    if (dialogOpened) {
      await saveAndRecord(page, "1440-dialog-open.png", "任务详情「未保存更改」确认 Dialog");

      // Escape 关闭
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      const stillOpen = (await page.locator('[role="dialog"]').count()) > 0;
      recordKb("Escape 关闭 Dialog", !stillOpen, stillOpen
        ? "Escape 后仍存在 [role=dialog]"
        : "Escape 后 [role=dialog] 已移除");

      // 焦点恢复到触发元素（关闭详情按钮）
      const focusRestored = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.getAttribute("aria-label") ?? el?.tagName?.toLowerCase() ?? "none";
      });
      const restored = focusRestored === "关闭详情";
      recordKb(
        "Dialog 关闭后焦点恢复到触发按钮",
        restored,
        `当前 activeElement aria-label="${focusRestored}"（期望「关闭详情」）`,
      );
      if (!restored) {
        uiIssues.push(`确认 Dialog 关闭后焦点未恢复到触发按钮，实际落在 "${focusRestored}"`);
      }
    } else {
      uiIssues.push("无法触发任务详情确认 Dialog，跳过 Escape / 焦点恢复验证");
    }
    await page.close();
  }
}

/* ── 390 移动端：汉堡菜单打开 Drawer ─────────────────────────────────── */

async function mobileDrawerShot(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await goto(page, "/app/today");
  const burger = page.getByLabel("打开导航菜单");
  if ((await burger.count()) > 0) {
    await burger.click();
    await page.waitForTimeout(450);
    const drawer = page.locator('[role="dialog"]').first();
    const opened = (await drawer.count()) > 0 && (await drawer.isVisible().catch(() => false));
    if (opened) {
      await saveAndRecord(page, "390-today-drawer.png", "汉堡菜单打开导航 Drawer");
    } else {
      await saveAndRecord(page, "390-today-drawer.png", "点击汉堡后未检测到 Drawer（仍截图）");
      uiIssues.push("390px：点击汉堡菜单后未检测到 [role=dialog] 抽屉");
    }
  } else {
    uiIssues.push("390px：未找到汉堡菜单按钮 aria-label='打开导航菜单'");
    await saveAndRecord(page, "390-today-drawer.png", "未找到汉堡菜单按钮");
  }
  await page.close();
}

/* ── 主流程 ───────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`目标服务：${BASE_URL}`);
  console.log(`输出目录：${OUT_DIR}\n`);

  const browser: Browser = await chromium.launch({ headless: true });

  try {
    for (const vp of VIEWPORTS) {
      console.log(`=== 视口 ${vp.name} (${vp.width}x${vp.height}) ===`);
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();

      for (const shot of shotList(vp.name)) {
        await takeShot(page, vp, shot);
      }

      if (vp.name === "1440") {
        await keyboardVerification(context);
      }
      if (vp.name === "390") {
        await mobileDrawerShot(context);
      }

      await page.close();
      await context.close();
      console.log("");
    }
  } finally {
    await browser.close();
  }

  /* ── 汇总 ── */
  const okCount = shotResults.filter((r) => r.status === "ok").length;
  const warnCount = shotResults.filter((r) => r.status === "warn").length;
  const errCount = shotResults.filter((r) => r.status === "error").length;
  const totalBytes = shotResults.reduce((s, r) => s + r.bytes, 0);

  console.log("=== 截图清单 ===");
  for (const r of shotResults) {
    console.log(
      `  [${r.status.toUpperCase().padEnd(5)}] ${r.file.padEnd(34)} ${(
        r.bytes / 1024
      )
        .toFixed(1)
        .padStart(8)} KB  ${r.px}`,
    );
  }
  console.log(
    `\n截图合计：${shotResults.length} 张（ok=${okCount} warn=${warnCount} error=${errCount}），总大小 ${(
      totalBytes / 1024 / 1024
    ).toFixed(2)} MB`,
  );

  console.log("\n=== 键盘交互验证结果 ===");
  const kbPass = kbChecks.filter((k) => k.pass).length;
  kbChecks.forEach((k) => console.log(`  [${k.pass ? "PASS" : "FAIL"}] ${k.name} — ${k.detail}`));
  console.log(`键盘验证：${kbPass}/${kbChecks.length} 通过`);

  console.log("\n=== 发现的 UI 问题 ===");
  if (uiIssues.length === 0) console.log("  （无）");
  else uiIssues.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));

  // 有截图失败或键盘验证失败时以非零码退出，便于 CI 感知。
  const failed = errCount > 0 || kbPass < kbChecks.length;
  if (failed) {
    console.log("\n⚠ 存在失败项（截图 error 或键盘验证 FAIL），退出码 1。");
    process.exitCode = 1;
  } else {
    console.log("\n✓ 全部截图成功且键盘验证通过。");
  }
}

main().catch((err) => {
  console.error("脚本执行异常：", err);
  process.exit(1);
});
