import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { establishSessionCookies } from "../ui/auth-setup";
import { cleanupTestEmails } from "./support/db";
import { ProjectSchema, SuccessResponseSchema } from "../../src/contracts";

for (const kind of ["project", "task"] as const) {
  test(`B6：${kind} 创建取消/收起保留草稿，确认放弃才关闭，保存无多余确认`, async ({ page, request }) => {
    test.setTimeout(45_000);
    const meta: { email?: string } = {};
    let dialogs = 0, accept = false;
    page.on("dialog", async dialog => { dialogs++; if (accept) await dialog.accept(); else await dialog.dismiss(); });
    try {
      await page.context().addCookies(await establishSessionCookies(request, process.env.E2E_AUTH_ORIGIN!, meta));
      const response = await request.post("/api/v1/projects", {
        headers: { origin: process.env.E2E_AUTH_ORIGIN!, "Idempotency-Key": randomUUID() },
        data: { name: "草稿验收项目", key: "P" + randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase() },
      });
      expect(response.status()).toBe(201);
      const project = SuccessResponseSchema(ProjectSchema).parse(await response.json()).data;
      await page.goto(kind === "project" ? "/app/projects" : `/app/projects/${project.id}/tasks`);
      const open = page.getByRole("button", { name: kind === "project" ? "新建项目" : "新建任务", exact: true }).first();
      await open.click();
      const field = page.getByRole("textbox", { name: kind === "project" ? "项目名称" : "任务标题", exact: true });
      await field.fill("必须保留的草稿");
      await page.getByRole("button", { name: "取消", exact: true }).click();
      expect(dialogs).toBe(1);
      await expect(field).toHaveValue("必须保留的草稿");
      await page.getByRole("button", { name: "收起表单", exact: true }).click();
      expect(dialogs).toBe(2);
      await expect(field).toHaveValue("必须保留的草稿");
      accept = true;
      await page.getByRole("button", { name: "收起表单", exact: true }).click();
      expect(dialogs).toBe(3);
      await expect(field).toHaveCount(0);
      await open.click();
      await expect(field).toHaveValue("");
      await field.fill("保存成功的草稿");
      if (kind === "project") await page.getByRole("textbox", { name: "项目标识", exact: true }).fill("P" + randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase());
      await page.getByRole("button", { name: kind === "project" ? "创建项目" : "创建任务", exact: true }).click();
      await expect(field).toHaveCount(0);
      expect(dialogs).toBe(3);
    } finally { if (meta.email) await cleanupTestEmails([meta.email]); }
  });
}
