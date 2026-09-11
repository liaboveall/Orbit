import dotenv from "dotenv";

/**
 * scripts/verify-e2e-target.mjs —— E2E_BASE_URL 复用前的环境核验（A10 修复）。
 *
 * 背景：`playwright.config.ts` 允许通过设置 `E2E_BASE_URL` 复用一个已经在跑的服务，
 * 跳过自建 webServer。这本身没问题，但必须先确认「那个已在跑的服务」连接的是测试库，
 * 而不是随手指向了开发服务器（那台服务器几乎总是连接 orbit_dev）——否则复用入口会
 * 变成绕过测试环境隔离的后门。
 *
 * 用法：node scripts/verify-e2e-target.mjs
 * 读取 process.env.E2E_BASE_URL；调用该地址的 GET /api/v1/me（无会话应返回 401，
 * 携带 x-request-id 头——这是判断"这是同一套 Orbit 应用"的最小指纹，不依赖任何
 * 需要认证才能看到的诊断端点）。仅凭 HTTP 探测无法从外部直接读出对方连接的
 * DATABASE_URL（这是刻意的：应用不应该也不会把连接串暴露给客户端），因此这里只能
 * 核验"目标确实是一个正在运行、行为符合预期的 Orbit 实例"，并要求调用方显式设置
 * E2E_ASSUME_TEST_DB=1 来承认"我已经在别处核实过这个地址背后连的是测试库"——
 * 不设置则直接拒绝，不做任何默认假设。
 *
 * 退出码：0 = 通过；非 0 = 拒绝（打印原因，不猜测、不静默通过）。
 */
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

async function main() {
  const baseURL = process.env.E2E_BASE_URL;
  if (!baseURL) {
    console.log("[verify-e2e-target] 未设置 E2E_BASE_URL，跳过（Playwright 将自建测试服务）。");
    return;
  }

  let parsed;
  try {
    parsed = new URL(baseURL);
  } catch {
    console.error(`[verify-e2e-target] E2E_BASE_URL 不是合法 URL：${baseURL}`);
    process.exit(1);
  }
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) {
    console.error(
      `[verify-e2e-target] E2E_BASE_URL 主机（${parsed.hostname}）不是 localhost/127.0.0.1，拒绝（docs/08 §1：只绑定 localhost）。`,
    );
    process.exit(1);
  }

  if (process.env.E2E_ASSUME_TEST_DB !== "1") {
    console.error(
      "[verify-e2e-target] 复用 E2E_BASE_URL 前必须显式设置 E2E_ASSUME_TEST_DB=1，" +
        "表示调用方已在别处核实该地址背后连接的是测试库（不是 orbit_dev）。" +
        " 未设置视为无法确认，拒绝运行。",
    );
    process.exit(1);
  }

  let response;
  try {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 10_000);
    try {
      response = await fetch(`${baseURL}/api/v1/me`, { method: "GET", signal: controller.signal });
    } finally {
      clearTimeout(abortTimer);
    }
  } catch (error) {
    console.error(
      `[verify-e2e-target] 无法连接 ${baseURL}（10s 超时）：${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }

  if (response.status !== 401) {
    console.error(
      `[verify-e2e-target] ${baseURL}/api/v1/me 返回 ${response.status}（预期 401 未认证）。` +
        " 目标可能不是一个干净的、无残留会话的 Orbit 实例，拒绝复用。",
    );
    process.exit(1);
  }
  if (!response.headers.get("x-request-id")) {
    console.error(
      `[verify-e2e-target] ${baseURL} 响应缺少 x-request-id 头，不像是本项目的 Orbit 实例，拒绝复用。`,
    );
    process.exit(1);
  }

  console.log(`[verify-e2e-target] 通过：${baseURL} 响应形状符合预期，且已显式确认连接测试库。`);
}

void main();
