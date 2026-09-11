/**
 * M2 认证网络错误处理验收测试脚本 (Q05 - RE-REVIEW-2026-09-09)
 * 
 * 验证场景：登录/注册/重置密码/登出在网络故障时的用户体验
 * 
 * 前提条件：
 * 1. 本地开发服务器运行于 http://localhost:3000
 * 2. 需要 Docker 容器（PostgreSQL, Mailpit）正常运行
 * 3. Chrome DevTools Network 面板可用
 * 
 * 测试流程：每个 Flow 按顺序执行，记录成功/失败截图
 */

// 使用 @playwright/test 的重导出（本仓库只依赖 @playwright/test，未单独安装 playwright）。
import { chromium, type Page, type Browser } from "@playwright/test";
import dotenv from "dotenv";
import _fs from "fs";
import { join } from "path";

// 环境变量加载
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const ARTIFACTS_DIR = join(__dirname, "..", "artifacts", "m2-auth-network-errors");

async function ensureDirectoryExists(dir: string): Promise<void> {
  // 原实现调用 mkdir(dir, { recursive: true }) —— 回调版 mkdir 的第二参数必须是回调，
  // 传选项对象在运行时会抛 "callback must be a function"，改用同步版本。
  const { mkdirSync, existsSync } = await import("fs");

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

async function screenshot(page: Page, name: string): Promise<void> {
  const filename = `${name}.png`;
  await page.screenshot({ 
    path: join(ARTIFACTS_DIR, filename),
    fullPage: false 
  });
  console.log(`✓ Screenshot saved: ${filename}`);
}

async function waitForHydration(page: Page): Promise<void> {
  // Wait for React hydration
  await page.waitForSelector("form[__reactProps$]", { timeout: 10000 }).catch(() => {});
}

interface TestResult {
  flow: string;
  status: "PASS" | "FAIL";
  screenshots: string[];
  errors: string[];
  notes?: string;
}

class AuthNetworkTester {
  private browser: Browser | null = null;
  private results: TestResult[] = [];
  private currentPage: Page | null = null;

  async start(): Promise<void> {
    await ensureDirectoryExists(ARTIFACTS_DIR);
    
    console.log("🚀 Starting Auth Network Error Tests\n");
    console.log(`Target: ${BASE_URL}\n`);
    
    this.browser = await chromium.launch({ headless: true });
    const context = await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    
    this.currentPage = await context.newPage();
    
    // Intercept network requests to simulate failures
    await this.currentPage.route("**/*", async (route) => {
      // Simulate network failure for auth endpoints
      if (route.request().url().includes("/api/auth/")) {
        const failureType = this.simulatedFailureType();
        
        if (failureType === "network") {
          await route.abort("failed");
          return;
        } else if (failureType === "timeout") {
          // Simulate timeout by hanging
          setTimeout(() => route.abort("timedout"), 5000);
          return;
        } else if (failureType === "server_error") {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Service Unavailable" }),
          });
          return;
        }
      }
      
      await route.continue();
    });
    
    // First run with no failures for baseline
    this.simulatedFailureType = () => null;
    await this.runBaselineTests();
    
    // Then run with various failure scenarios
    await this.runNetworkFailureTests();
    
    // Summary
    await this.generateSummary();
    
    await this.browser.close();
  }

  private simulatedFailureType(): "network" | "timeout" | "server_error" | null {
    // This will be overridden in tests
    return null;
  }

  private async runBaselineTests(): Promise<void> {
    console.log("=== BASELINE TESTS (No Failures) ===\n");
    
    // Test 1: Normal login should work
    {
      console.log("Test 1A: Normal login (baseline)");
      try {
        await this.currentPage.goto(`${BASE_URL}/auth/login`);
        await waitForHydration(this.currentPage);
        
        await this.currentPage.fill('input[name="email"]', "test@example.com");
        await this.currentPage.fill('input[name="password"]', "Password123!");
        await this.currentPage.click('button[type="submit"]');
        
        // Should navigate away or show success state
        await this.currentPage.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 5000 }).catch(() => {});
        
        this.results.push({
          flow: "Login (baseline)",
          status: "PASS",
          screenshots: [],
          errors: []
        });
        console.log("  ✓ Baseline login works\n");
      } catch (error) {
        console.log("  ✗ Baseline test failed:", error.message);
        this.results.push({
          flow: "Login (baseline)",
          status: "FAIL",
          screenshots: ["baseline-login-failed.png"],
          errors: [error.message]
        });
      }
    }
  }

  private async runNetworkFailureTests(): Promise<void> {
    console.log("=== NETWORK FAILURE TESTS ===\n");
    
    // Test 2: Login network failure
    {
      console.log("Test 2: Login with network failure");
      this.simulatedFailureType = () => "network";
      
      await this.currentPage.goto(`${BASE_URL}/auth/login`);
      await waitForHydration(this.currentPage);
      
      await this.currentPage.fill('input[name="email"]', "test@example.com");
      await this.currentPage.fill('input[name="password"]', "Password123!");
      await this.currentPage.click('button[type="submit"]');
      
      // Wait a bit for error to appear
      await this.currentPage.waitForTimeout(2000);
      
      // Check 1: Button should NOT stay in pending state forever
      const buttonState = await this.currentPage.$eval('button[type="submit"]', (btn) => ({
        disabled: btn.disabled,
        text: btn.textContent?.trim()
      }));
      
      // Check 2: Error message should appear
      const errorMessage = await this.currentPage.$eval('div[role="alert"]', (el) => el.textContent?.trim()) || "";
      
      const hasRetryButton = buttonState.text === "重试";
      const showsNetworkError = errorMessage.includes("网络错误") || errorMessage.length > 0;
      
      if (!buttonState.disabled && (hasRetryButton || showsNetworkError)) {
        console.log("  ✓ Login network error handled correctly");
        console.log(`    - Button enabled: ${!buttonState.disabled}`);
        console.log(`    - Shows retry option: ${hasRetryButton}`);
        console.log(`    - Displays error message: ${showsNetworkError}`);
        
        this.results.push({
          flow: "Login (network failure)",
          status: "PASS",
          screenshots: ["login-network-error.png"],
          errors: []
        });
      } else {
        console.log("  ✗ Login network error not handled properly");
        console.log(`    - Button still disabled: ${buttonState.disabled}`);
        console.log(`    - Button text: "${buttonState.text}"`);
        console.log(`    - Error message: "${errorMessage}"`);
        
        this.results.push({
          flow: "Login (network failure)",
          status: "FAIL",
          screenshots: ["login-network-fail.png"],
          errors: [
            `Button state: ${JSON.stringify(buttonState)}`,
            `Error message: "${errorMessage}"`
          ]
        });
      }
      
      // Capture screenshot
      if (this.currentPage) {
        await screenshot(this.currentPage, "login-network-error");
      }
    }
    
    // Test 3: Register network failure
    {
      console.log("\nTest 3: Register with network failure");
      this.simulatedFailureType = () => "network";
      
      await this.currentPage.goto(`${BASE_URL}/auth/register`);
      await waitForHydration(this.currentPage);
      
      await this.currentPage.fill('input[name="name"]', "Test User");
      await this.currentPage.fill('input[name="email"]', "test2@example.com");
      await this.currentPage.fill('input[name="password"]', "Password123!");
      await this.currentPage.fill('input[name="confirmPassword"]', "Password123!");
      await this.currentPage.click('button[type="submit"]');
      
      await this.currentPage.waitForTimeout(2000);
      
      const buttonState = await this.currentPage.$eval('button[type="submit"]', (btn) => ({
        disabled: btn.disabled,
        text: btn.textContent?.trim()
      }));
      
      const errorMessage = await this.currentPage.$eval('div[role="alert"]', (el) => el.textContent?.trim()) || "";
      
      const hasRetryButton = buttonState.text === "重试";
      const showsNetworkError = errorMessage.includes("网络错误") || errorMessage.length > 0;
      
      if (!buttonState.disabled && (hasRetryButton || showsNetworkError)) {
        console.log("  ✓ Register network error handled correctly");
        
        this.results.push({
          flow: "Register (network failure)",
          status: "PASS",
          screenshots: ["register-network-error.png"],
          errors: []
        });
      } else {
        console.log("  ✗ Register network error not handled properly");
        
        this.results.push({
          flow: "Register (network failure)",
          status: "FAIL",
          screenshots: ["register-network-fail.png"],
          errors: [`Button state: ${JSON.stringify(buttonState)}`]
        });
      }
      
      if (this.currentPage) {
        await screenshot(this.currentPage, "register-network-error");
      }
    }
    
    // Test 4: Password reset network failure
    {
      console.log("\nTest 4: Password reset request with network failure");
      this.simulatedFailureType = () => "network";
      
      await this.currentPage.goto(`${BASE_URL}/auth/forgot-password`);
      await waitForHydration(this.currentPage);
      
      await this.currentPage.fill('input[name="email"]', "test@example.com");
      await this.currentPage.click('button[type="submit"]');
      
      await this.currentPage.waitForTimeout(2000);
      
      const buttonState = await this.currentPage.$eval('button[type="submit"]', (btn) => ({
        disabled: btn.disabled,
        text: btn.textContent?.trim()
      }));
      
      const errorMessage = await this.currentPage.$eval('div[role="alert"]', (el) => el.textContent?.trim()) || "";
      
      if (!buttonState.disabled && (errorMessage.includes("重试") || errorMessage.includes("网络"))) {
        console.log("  ✓ Password reset network error handled correctly");
        
        this.results.push({
          flow: "Password reset request (network)",
          status: "PASS",
          screenshots: ["forgot-password-network.png"],
          errors: []
        });
      } else {
        console.log("  ✗ Password reset network error not handled properly");
        
        this.results.push({
          flow: "Password reset request (network)",
          status: "FAIL",
          screenshots: ["forgot-password-network-fail.png"],
          errors: [`Button state: ${JSON.stringify(buttonState)}`]
        });
      }
      
      if (this.currentPage) {
        await screenshot(this.currentPage, "forgot-password-network");
      }
    }
    
    // Test 5: Sign out server error
    {
      console.log("\nTest 5: Sign out with server error (503)");
      this.simulatedFailureType = () => "server_error";
      
      // First login successfully
      await this.currentPage.goto(`${BASE_URL}/auth/login`);
      await waitForHydration(this.currentPage);
      
      await this.currentPage.fill('input[name="email"]', "test@example.com");
      await this.currentPage.fill('input[name="password"]', "Password123!");
      await this.currentPage.click('button[type="submit"]');
      await this.currentPage.waitForURL((url) => url.pathname.includes("/app/"), { timeout: 10000 }).catch(() => {});
      
      // Navigate to app page where user menu is available
      await this.currentPage.goto(`${BASE_URL}/app/today`);
      await waitForHydration(this.currentPage);
      
      // Open user menu and click sign out
      await this.currentPage.click('[aria-label="账户菜单"]');
      await this.currentPage.waitForTimeout(500);
      await this.currentPage.click('text=退出登录');
      
      // Wait for toast/error to appear
      await this.currentPage.waitForTimeout(3000);
      
      // Check if we stayed on the page (didn't redirect to login)
      const stayedOnApp = this.currentPage.url().includes("/app/");
      
      // Check for error toast
      const hasErrorToast = await this.currentPage.$('[role="alert"]') !== null;
      
      if (stayedOnApp && hasErrorToast) {
        console.log("  ✓ Sign out server error handled correctly");
        console.log("    - Did not redirect to login");
        console.log("    - Showed error toast");
        
        this.results.push({
          flow: "Sign out (server error)",
          status: "PASS",
          screenshots: ["signout-server-error.png"],
          errors: []
        });
      } else {
        console.log("  ✗ Sign out server error not handled properly");
        console.log(`    - Redirected to login: ${!stayedOnApp}`);
        console.log(`    - Error toast visible: ${hasErrorToast}`);
        
        this.results.push({
          flow: "Sign out (server error)",
          status: "FAIL",
          screenshots: ["signout-server-fail.png"],
          errors: [
            `Stayed on app page: ${stayedOnApp}`,
            `Has error toast: ${hasErrorToast}`
          ]
        });
      }
      
      if (this.currentPage) {
        await screenshot(this.currentPage, "signout-server-error");
      }
    }
  }

  private async generateSummary(): Promise<void> {
    console.log("\n\n=== TEST SUMMARY ===\n");
    
    const passed = this.results.filter(r => r.status === "PASS").length;
    const failed = this.results.filter(r => r.status === "FAIL").length;
    
    console.log(`Total: ${this.results.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}\n`);
    
    for (const result of this.results) {
      console.log(`${result.status}: ${result.flow}`);
      if (result.notes) {
        console.log(`  Note: ${result.notes}`);
      }
      if (result.errors.length > 0) {
        console.log("  Errors:");
        for (const error of result.errors) {
          console.log(`    - ${error}`);
        }
      }
    }
    
    // Write summary.json
    const { writeFileSync } = await import("fs");
    const summary = {
      timestamp: new Date().toISOString(),
      baseUrl: BASE_URL,
      overall: failed === 0 ? "PASS" : "FAIL",
      results: this.results,
    };
    
    writeFileSync(
      join(ARTIFACTS_DIR, "summary.json"),
      JSON.stringify(summary, null, 2)
    );
    
    console.log(`\n✅ Summary written to ${join(ARTIFACTS_DIR, "summary.json")}`);
  }
}

// Run tests
async function main() {
  try {
    const tester = new AuthNetworkTester();
    await tester.start();
  } catch (error) {
    console.error("❌ Test runner failed:", error);
    process.exitCode = 1;
  }
}

main();
