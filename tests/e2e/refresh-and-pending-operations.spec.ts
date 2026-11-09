import { test, expect } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { establishSessionCookies } from "../ui/auth-setup";
import { cleanupTestEmails, withTestDb } from "./support/db";
import { ProjectSchema, TaskSchema, SuccessResponseSchema, type ProjectDTO, type TaskDTO } from "../../src/contracts";
const origin = process.env.E2E_AUTH_ORIGIN!;
let emails: string[] = [], project: ProjectDTO, task: TaskDTO;
const write = () => ({ origin, "Idempotency-Key": randomUUID() });
test.beforeEach(async ({ request, context, baseURL }) => {
  const meta: { email?: string } = {};
  try { await context.addCookies(await establishSessionCookies(request, baseURL!, meta)); }
  finally { if (meta.email) emails.push(meta.email); }
  const p = await request.post("/api/v1/projects", { headers: write(), data: { name: "审查夹具", key: "R" + randomUUID().replaceAll("-", "").slice(0,7).toUpperCase() } });
  expect(p.status()).toBe(201);
  project = SuccessResponseSchema(ProjectSchema).parse(await p.json()).data;
  const t = await request.post(`/api/v1/projects/${project.id}/tasks`, { headers: write(), data: { title: "审查任务" } });
  expect(t.status()).toBe(201);
  task = SuccessResponseSchema(TaskSchema).parse(await t.json()).data;
});
test.afterEach(async ({ page }) => { await page.close(); await cleanupTestEmails(emails); emails=[]; });

for (const kind of ["comments", "subtasks"] as const) {
  for (const failure of ["network", "500"] as const) {
  test(`regression: ${kind} edit draft survives background GET ${failure} failure and retry`, async ({ page, request }) => {
    const comment = kind === "comments";
    const created = await request.post(`/api/v1/tasks/${task.id}/${kind}`, { headers: write(), data: comment ? { body: "原内容" } : { title: "原标题" } });
    expect(created.status()).toBe(201);
    await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
    await page.getByRole("button", { name: comment ? "编辑评论" : "编辑子任务", exact:true }).click();
    const input = page.getByRole("textbox", { name: comment ? "编辑评论内容" : "编辑子任务标题", exact: true });
    await input.fill("尚未保存的草稿");
    await page.route(`**/api/v1/tasks/${task.id}/${kind}*`, route => failure === "network" ? route.abort("failed") : route.fulfill({status:500,json:{error:{code:"INTERNAL_ERROR",message:"Synthetic failure"},meta:{requestId:randomUUID()}}}));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const section = page.getByRole("region", { name: comment ? "评论" : "子任务", exact: true });
    await expect(section.getByRole("button", { name: "重新加载", exact: true })).toBeVisible();
    await expect(input).toHaveValue("尚未保存的草稿");
    await page.unroute(`**/api/v1/tasks/${task.id}/${kind}*`);
    await section.getByRole("button", { name: "重新加载", exact:true }).click();
    await expect(section.getByRole("button", { name: "重新加载", exact:true })).toHaveCount(0);
    await expect(input).toHaveValue("尚未保存的草稿");
    const saved: {data: {id:string;version:number}} = await created.json();
    expect((await request.patch(`/api/v1/${kind}/${saved.data.id}`, { headers: {origin}, data: comment ? {body:"远端修改",expectedVersion:saved.data.version} : {title:"远端修改",expectedVersion:saved.data.version} })).status()).toBe(200);
    const refreshed = page.waitForResponse(r => r.url().includes(`/api/v1/tasks/${task.id}/${kind}`));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await refreshed;
    await expect(input).toHaveValue("尚未保存的草稿");
    await section.getByRole("button", {name:"保存",exact:true}).click();
    await expect(section.getByRole("button", {name:"保留我的修改并重试",exact:true})).toBeVisible();
    await expect(input).toHaveValue("尚未保存的草稿");
  });
  }
}

test("regression: comment input is frozen while POST is pending", async ({ page, request }) => {
  await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
  let release = () => {};
  const gate = new Promise<void>(resolve => { release=resolve; });
  await page.route(`**/api/v1/tasks/${task.id}/comments`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  const input = page.getByRole("textbox", { name: "评论正文", exact:true });
  await input.fill("已提交文本");
  await page.getByRole("button", { name: "发表评论", exact:true }).click();
  await expect(page.getByRole("button", { name: "发布中…", exact:true })).toBeVisible();
  await expect(input).toBeDisabled();
  release();
  await expect(input).toHaveValue("");
  const rows: { data: Array<{body: string|null}> } = await (await request.get(`/api/v1/tasks/${task.id}/comments`)).json();
  expect(rows.data.map(r=>r.body)).toEqual(["已提交文本"]);
});

test("regression: workbench focus refresh preserves the already loaded window", async ({ page }) => {
  await withTestDb(async c => {
    await c.query('UPDATE "Task" SET "assigneeId"="creatorId" WHERE id=$1::uuid', [task.id]);
    for (let number=2; number<=35; number++) {
      await c.query('INSERT INTO "Task" (id,"projectId",number,"creatorId","assigneeId",title,position,"updatedAt") VALUES ($1::uuid,$2::uuid,$3,$4,$4,$5,$6,NOW())', [randomUUID(),project.id,number,task.creator.id,"分页审查 "+number,number*1024]);
    }
  });
  await page.goto(`/app/today?projectId=${project.id}`);
  const section = page.getByRole("region", { name: "我的任务", exact:true });
  await expect(section.getByRole("listitem")).toHaveCount(30);
  await section.getByRole("button", { name: "加载更多", exact:true }).click();
  await expect(section.getByRole("listitem")).toHaveCount(35);
  const reloaded = page.waitForResponse(r => r.url().includes("/api/v1/my/tasks"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await reloaded;
  await expect(section.getByRole("listitem")).toHaveCount(35);
});

test("regression: board focus refresh preserves full loading and sorting", async ({ page }) => {
  await withTestDb(async c => {
    for (let number=2; number<=55; number++) {
      await c.query('INSERT INTO "Task" (id,"projectId",number,"creatorId",title,position,"updatedAt") VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,NOW())', [randomUUID(),project.id,number,task.creator.id,"看板分页审查 "+number,number*1024]);
    }
  });
  await page.goto(`/app/projects/${project.id}/board`);
  const all = page.getByRole("button", { name: "加载全部后排序", exact:true });
  await all.click();
  await expect(all).toHaveCount(0);
  await expect(page.getByRole("button", { name: `排序 ${task.identifier}`, exact:true })).toBeEnabled();
  const reloaded = page.waitForResponse(r => r.url().includes(`/api/v1/projects/${project.id}/board`));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await reloaded;
  await expect(all).toHaveCount(0);
  await expect(page.getByRole("button", { name: `排序 ${task.identifier}`, exact:true })).toBeEnabled();
});

test("regression: upload endpoint rejects the eleventh request within a minute", async ({ request }) => {
  const bytes=Buffer.from("small audit fixture"), uploadId=randomUUID();
  const statuses:number[]=[];
  for(let i=0;i<11;i++) {
    const res=await request.post(`/api/v1/tasks/${task.id}/attachments`, {
      headers: {origin},
      multipart: {uploadId,declaredSizeBytes:String(bytes.length),sha256:createHash("sha256").update(bytes).digest("hex"),file:{name:"audit.txt",mimeType:"text/plain",buffer:bytes}},
    });
    statuses.push(res.status());
  }
  expect(statuses).toEqual([201,...Array(9).fill(200),429]);
});

test("regression: closing task panel protects unsubmitted comments until explicit discard", async ({ page }) => {
  await page.goto(`/app/projects/${project.id}/tasks?task=${task.id}`);
  const input=page.getByRole("textbox",{name:"评论正文",exact:true});
  await input.fill("关闭前尚未提交的评论");
  await page.getByRole("button",{name:"关闭详情",exact:true}).click();
  await expect(page.getByRole("dialog", {name:"你有未保存的更改"})).toBeVisible();
  await page.getByRole("button", {name:"保留编辑", exact:true}).click();
  await expect(input).toHaveValue("关闭前尚未提交的评论");
  await page.getByRole("button",{name:"关闭详情",exact:true}).click();
  await page.getByRole("button",{name:"放弃更改",exact:true}).click();
  await expect(input).toHaveCount(0);
  await page.goto(`/app/projects/${project.id}/tasks?task=${task.id}`);
  await expect(input).toHaveValue("");
});

test("project task pagination survives refresh and resets on a real filter change", async ({ page }) => {
  await withTestDb(async c => {
    await c.query('INSERT INTO "Task" (id,"projectId",number,"creatorId",title,position,"updatedAt") SELECT gen_random_uuid(),$1::uuid,n,$2,\'列表分页 \'||n,n*1024,NOW() FROM generate_series(2,55) n', [project.id, task.creator.id]);
  });
  await page.goto(`/app/projects/${project.id}/tasks`);
  await page.getByRole("button", {name:"加载更多",exact:true}).click();
  await expect(page.getByRole("row")).toHaveCount(56);
  const refreshed = page.waitForResponse(r => r.url().includes(`/api/v1/projects/${project.id}/tasks`));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
  await expect(page.getByRole("row")).toHaveCount(56);
  await page.getByRole("searchbox", {name:"搜索任务",exact:true}).fill("审查任务");
  await page.getByRole("searchbox", {name:"搜索任务",exact:true}).press("Enter");
  await expect(page.getByRole("row")).toHaveCount(2);
});

for (const kind of ["comments", "subtasks"] as const) {
  for (const navigationMode of ["navigation-api", "history-fallback"] as const) {
  test(`${kind} row editors protect panel close and navigation (${navigationMode})`, async ({ page, request }) => {
    const comment = kind === "comments";
    expect((await request.post(`/api/v1/tasks/${task.id}/${kind}`, {headers:write(),data:comment?{body:"评论原文"}:{title:"子任务原文"}})).status()).toBe(201);
    if (navigationMode === "history-fallback") await page.addInitScript(() => Object.defineProperty(window, "navigation", {value:undefined, configurable:true}));
    await page.goto(`/app/projects/${project.id}/tasks`);
    await page.locator(`[data-task-link="${task.id}"]`).click();
    await page.getByRole("button", {name:comment?"编辑评论":"编辑子任务",exact:true}).click();
    const input = page.getByRole("textbox", {name:comment?"编辑评论内容":"编辑子任务标题",exact:true});
    await input.fill("继续编辑的草稿");
    await page.getByRole("button", {name:"关闭详情",exact:true}).click();
    await expect(page.getByRole("dialog", {name:"你有未保存的更改"})).toBeVisible();
    await page.getByRole("button", {name:"保留编辑",exact:true}).click();
    await expect(input).toHaveValue("继续编辑的草稿");
    page.once("dialog", dialog => dialog.dismiss());
    await page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "/app/today";
      document.body.append(link);
      link.click();
      link.remove();
    });
    await expect(input).toHaveValue("继续编辑的草稿");
    await expect(page).toHaveURL(new RegExp(`task=${task.id}`));
    const dismissed = new Promise<void>(resolve => page.once("dialog", async dialog => { await dialog.dismiss(); resolve(); }));
    await page.evaluate(() => history.back());
    await dismissed;
    await expect(page).toHaveURL(new RegExp(`task=${task.id}`));
    await expect(input).toHaveValue("继续编辑的草稿");
  });
  }
}

test("upload concurrency is shared across tasks and cancellation frees the slot", async ({ request, baseURL }) => {
  const secondTask = SuccessResponseSchema(TaskSchema).parse(await (await request.post(`/api/v1/projects/${project.id}/tasks`, { headers: write(), data: { title: "第二个上传目标" } })).json()).data;
  const cookie = (await request.storageState()).cookies.map(c => `${c.name}=${c.value}`).join("; ");
  const bytes = Buffer.from("concurrent synthetic upload"), sha = createHash("sha256").update(bytes).digest("hex");
  function start(target: string) {
    const boundary = `orbit-${randomUUID()}`;
    let settle: (status: number) => void = () => {};
    const done = new Promise<number>(resolve => { settle = resolve; });
    const req = httpRequest(new URL(`/api/v1/tasks/${target}/attachments`, baseURL), { method: "POST", headers: { origin, cookie, "content-type": `multipart/form-data; boundary=${boundary}` } }, res => { res.resume(); res.on("end", () => settle(res.statusCode ?? 0)); });
    req.on("error", () => settle(0));
    for (const [key, value] of Object.entries({ uploadId: randomUUID(), declaredSizeBytes: String(bytes.length), sha256: sha })) req.write(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
    req.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="concurrency.txt"\r\nContent-Type: text/plain\r\n\r\n`);
    req.write(bytes);
    return { req, done, finish: () => req.end(`\r\n--${boundary}--\r\n`) };
  }
  const first = start(task.id), second = start(secondTask.id);
  try {
    await expect.poll(() => withTestDb(async c => Number((await c.query('SELECT count(*) FROM "Attachment" WHERE "projectId"=$1::uuid AND state=\'UPLOADING\'', [project.id])).rows[0].count))).toBe(2);
    const uploadId = randomUUID();
    const attempt = () => request.post(`/api/v1/tasks/${task.id}/attachments`, { headers: { origin }, multipart: { uploadId, declaredSizeBytes: String(bytes.length), sha256: sha, file: { name: "next.txt", mimeType: "text/plain", buffer: bytes } } });
    expect((await attempt()).status()).toBe(429);
    first.req.destroy();
    await first.done;
    await expect.poll(async () => (await attempt()).status()).toBe(201);
    second.finish();
    expect(await second.done).toBe(201);
  } finally {
    first.req.destroy(); second.req.destroy();
    await Promise.all([first.done, second.done]);
    await expect.poll(() => withTestDb(async c => Number((await c.query('SELECT count(*) FROM "Attachment" WHERE "projectId"=$1::uuid AND state=\'UPLOADING\'', [project.id])).rows[0].count))).toBe(0);
  }
});

test("subtask input is frozen during a pending create and recovers after failure", async ({page}) => {
  await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
  await page.getByRole("button",{name:"添加子任务",exact:true}).click();
  const input = page.getByRole("textbox",{name:"新子任务标题",exact:true});
  await input.fill("保留添加草稿");
  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/v1/tasks/${task.id}/subtasks`, async route => {
    if(route.request().method() !== "POST") return route.continue();
    await pending;
    await route.abort("failed");
  });
  try {
    await page.getByRole("button",{name:"添加",exact:true}).click();
    await expect(input).toBeDisabled();
    release();
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue("保留添加草稿");
  } finally { release(); }
});
