/**
 * M4 - Project Settings R1 Fix Verification (ORB-007)
 * 
 * 场景：验证冲突处理时 GET 失败不会隐式推进 baseline.version
 * 
 * 步骤：
 * 1. 用户 A 编辑项目，本地修改 name="Draft V1"
 * 2. 用户 B（或另一请求）将远程改为 version 2，name="Remote V2", description="Remote desc"
 * 3. 用户 A 保存 → 409 VERSION_CONFLICT
 * 4. interceptor 拦截后续 GET → 返回 500 错误
 * 5. **关键**：baseline.version 仍为 1（未进位到 2）
 * 6. 用户尝试再次保存 → 应被禁用（conflictPending=true）
 * 7. 用户点击"重新获取远端内容"重试 → 成功获取
 * 8. 用户选择"保留我的修改并重试" → baseline 前进到 2
 * 9. 再次保存 → 成功，数据库中的 name 应为"Local draft"（非 Remote V2）
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { ProjectSchema, SuccessResponseSchema, type ProjectDTO } from "../../src/contracts";
import { establishSessionCookies } from "../ui/auth-setup";
import {cleanupTestEmails} from "./support/db";
let email = "";

// 加载环境变量
dotenv.config({ path: [".env.local", ".env"], quiet: true });

const origin = process.env.E2E_AUTH_ORIGIN ?? `http://localhost:${process.env.E2E_PORT ?? "3100"}`;

let project: ProjectDTO;

/** 通过 API 创建项目（统一信封 → ProjectDTO）。 */
async function createProject(request: APIRequestContext, name: string): Promise<ProjectDTO> {
  const res = await request.post("/api/v1/projects", {
    headers: { origin, "Idempotency-Key": randomUUID() },
    data: { name, key: "M" + randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase() },
  });
  expect(res.status()).toBe(201);
  return SuccessResponseSchema(ProjectSchema).parse(await res.json()).data;
}

test.beforeEach(async ({ request, context, baseURL }) => {
  // 1) 建立会话 cookie（真实注册 → Mailpit 验证 → autoSignIn 流程）
  const meta: {email?: string} = {};
  try { await context.addCookies(await establishSessionCookies(request, baseURL!, meta)); }
  finally { email = meta.email ?? ""; }
  
  // 2) 验证会话有效
  const me = await request.get("/api/v1/me");
  expect(me.status()).toBe(200);
  
  // 3) 创建测试专用项目
  project = await createProject(request, "R1 Fix Test Project");
});

test.afterEach(async () => { if (email) await cleanupTestEmails([email]); email = ""; });

for (const failure of ["network", 500, 503] as const) {
  test(`R1: ${failure} during conflict recovery keeps saving blocked until review`, async ({page,request}) => {
    await page.goto(`/app/projects/${project.id}/settings`);
    await page.getByLabel("项目名称",{exact:true}).fill("Local R1 draft");
    expect((await request.patch(`/api/v1/projects/${project.id}`,{headers:{origin},data:{expectedVersion:1,name:"Remote R1 title"}})).status()).toBe(200);
    await page.route(`**/api/v1/projects/${project.id}`,route=>{
      if(route.request().method()!=="GET")return route.continue();
      if(failure==="network")return route.abort("failed");
      return route.fulfill({status:failure,contentType:"application/json",body:JSON.stringify({error:{code:"INTERNAL_ERROR",message:"Temporary audit failure"},meta:{requestId:"r1-recovery"}})});
    });
    const save=page.getByRole("button",{name:"保存修改",exact:true});
    await save.click();
    const retry=page.getByRole("button",{name:"重新获取远端内容",exact:true});
    await expect(retry).toBeEnabled();
    await expect(save).toBeDisabled();
    await retry.click();
    await expect(retry).toBeEnabled();
    await expect(save).toBeDisabled();
    await expect(page.getByLabel("项目名称",{exact:true})).toHaveValue("Local R1 draft");
    expect((await (await request.get(`/api/v1/projects/${project.id}`)).json()).data.name).toBe("Remote R1 title");
    await page.unroute(`**/api/v1/projects/${project.id}`);
    await retry.click();
    await expect(page.getByText("Remote R1 title",{exact:true})).toBeVisible();
    await expect(save).toBeDisabled();
    await page.getByRole("button",{name:"采用远端内容重新编辑",exact:true}).click();
    await expect(page.getByLabel("项目名称",{exact:true})).toHaveValue("Remote R1 title");
    await expect(save).toBeDisabled();
  });
}
