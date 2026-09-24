import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { establishSessionCookies } from "../ui/auth-setup";
import { cleanupTestEmails, withTestDb } from "./support/db";

test("N01：真实服务端渲染失败后，重试发新 RSC 请求并恢复工作台", async ({ page, request }) => {
  test.setTimeout(45_000);
  const meta: { email?: string } = {};
  const file = process.env.ORBIT_TEST_FAULT_FILE!;
  try {
    await page.context().addCookies(await establishSessionCookies(request, process.env.E2E_AUTH_ORIGIN!, meta));
    const id = await withTestDb(async client => (await client.query<{ id: string }>('SELECT id FROM "User" WHERE email=$1', [meta.email])).rows[0]!.id);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ userId: id, hits: 0 }));
    await page.goto("/app/today");
    const failure = page.getByRole("alert").filter({ hasText: "工作台加载失败，请稍后重试。" });
    await expect(failure).toBeVisible();
    expect(JSON.parse(await readFile(file, "utf8")).hits).toBeGreaterThan(0);
    await rm(file);
    const refetch = page.waitForRequest(req => new URL(req.url()).pathname === "/app/today" && req.headers()["rsc"] === "1");
    await page.getByRole("button", { name: "重新加载", exact: true }).click();
    await refetch;
    await expect(page.getByRole("heading", { name: "我的工作台", exact: true })).toBeVisible();
    await expect(failure).toHaveCount(0);
  } finally {
    await rm(file, { force: true });
    if (meta.email) await cleanupTestEmails([meta.email]);
  }
});
