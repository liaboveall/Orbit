import { test, expect } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { establishSessionCookies } from "../ui/auth-setup";
import { cleanupTestEmails, withTestDb } from "./support/db";
import {
  ProjectSchema,
  TaskSchema,
  SuccessResponseSchema,
  type ProjectDTO,
  type TaskDTO,
} from "../../src/contracts";
import { CommentSchema, ListResponseSchema } from "../../src/contracts";
const origin = process.env.E2E_AUTH_ORIGIN!;
let emails: string[] = [],
  project: ProjectDTO,
  task: TaskDTO;
const write = () => ({ origin, "Idempotency-Key": randomUUID() });
test.beforeEach(async ({ request, context, baseURL }) => {
  const meta: { email?: string } = {};
  try {
    await context.addCookies(
      await establishSessionCookies(request, baseURL!, meta),
    );
  } finally {
    if (meta.email) emails.push(meta.email);
  }
  const p = await request.post("/api/v1/projects", {
    headers: write(),
    data: {
      name: "M5 浏览器验收",
      key: "B" + randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase(),
    },
  });
  expect(p.status()).toBe(201);
  project = SuccessResponseSchema(ProjectSchema).parse(await p.json()).data;
  const t = await request.post(`/api/v1/projects/${project.id}/tasks`, {
    headers: write(),
    data: { title: "M5 真实协作任务" },
  });
  expect(t.status()).toBe(201);
  task = SuccessResponseSchema(TaskSchema).parse(await t.json()).data;
});
test.afterEach(async () => {
  await cleanupTestEmails(emails);
  emails = [];
});

test("keyboard subtask and lost comment response retry preserve drafts without duplicates", async ({
  page,
  request,
}) => {
  await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
  const subtasks = page.getByRole("region", { name: "子任务", exact: true });
  await subtasks
    .getByRole("button", { name: "添加子任务", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "新子任务标题" })
    .fill("键盘验收子任务");
  await page.keyboard.press("Enter");
  await expect(
    subtasks.getByText("键盘验收子任务", { exact: true }),
  ).toBeVisible();
  await subtasks
    .getByRole("button", { name: "标记为完成", exact: true })
    .focus();
  await page.keyboard.press("Space");
  await expect(
    subtasks.getByRole("button", { name: "标记为未完成", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const comments = page.getByRole("region", { name: "评论", exact: true });
  let first = true;
  const keys: string[] = [];
  await page.route(`**/api/v1/tasks/${task.id}/comments`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]!);
    if (first) {
      first = false;
      const result = await route.fetch();
      expect(result.status()).toBe(201);
      return route.abort("failed");
    }
    return route.continue();
  });
  await comments
    .getByRole("textbox", { name: "评论正文", exact: true })
    .fill("丢响应仍只发布一次");
  await comments.getByRole("button", { name: "发表评论", exact: true }).click();
  await expect(
    comments.getByRole("textbox", { name: "评论正文", exact: true }),
  ).toHaveValue("丢响应仍只发布一次");
  await expect(comments.getByText(/无法连接服务器/)).toBeVisible();
  await comments.getByRole("button", { name: "发表评论", exact: true }).click();
  await expect(
    comments.getByRole("textbox", { name: "评论正文", exact: true }),
  ).toHaveValue("");
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const rows = ListResponseSchema(CommentSchema).parse(
    await (await request.get(`/api/v1/tasks/${task.id}/comments`)).json(),
  ).data;
  expect(rows.filter((r) => r.body === "丢响应仍只发布一次")).toHaveLength(1);
  for (const resource of ["comments", "subtasks"]) {
    const invalid = await request.post(`/api/v1/tasks/${task.id}/${resource}`, {
      headers: { origin, "Idempotency-Key": "not-a-uuid" },
      data:
        resource === "comments" ? { body: "bad key" } : { title: "bad key" },
    });
    expect(invalid.status()).toBe(400);
  }
});

test("mobile private attachment upload and signed download roundtrip", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
  const attachments = page.getByRole("region", { name: "附件", exact: true }),
    bytes = Buffer.from("浏览器真实上传，中文附件。");
  await page
    .getByLabel("选择要上传的文件")
    .setInputFiles({
      name: "验收说明.txt",
      mimeType: "text/plain",
      buffer: bytes,
    });
  await attachments.getByRole("button", { name: "上传", exact: true }).click();
  await expect(
    attachments.getByRole("button", { name: "下载附件" }),
  ).toBeVisible();
  const pending = page.waitForEvent("download");
  await attachments.getByRole("button", { name: "下载附件" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("验收说明.txt");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks)).toEqual(bytes);
  const rows = (
    await (await request.get(`/api/v1/tasks/${task.id}/attachments`)).json()
  ).data;
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain("objectKey");
  await attachments.getByRole("button", { name: "删除附件" }).click();
  const deleted = page.waitForResponse(response => response.request().method()==="DELETE" && response.url().includes("/api/v1/attachments/"));
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  const deletedResponse=await deleted;
  expect(deletedResponse.status()).toBe(204);
  expect(deletedResponse.headers()["cache-control"]).toContain("no-store");
  expect(deletedResponse.headers()["x-request-id"]).toBeTruthy();
  await expect(
    attachments.getByText("暂无附件。", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("comments retain loaded pages and draft on focus refresh; workbench shows assigned real task", async ({
  page,
  request,
}) => {
  await withTestDb(async (db) => {
    const user = await db.query<{ id: string }>(
      'SELECT id FROM "User" WHERE email=$1',
      [emails[0]],
    );
    await db.query('UPDATE "Task" SET "assigneeId"=$1 WHERE id=$2', [
      user.rows[0]!.id,
      task.id,
    ]);
    for (let i = 0; i < 35; i++)
      await db.query(
        'INSERT INTO "Comment" (id,"taskId","authorId",body,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$5)',
        [
          randomUUID(),
          task.id,
          user.rows[0]!.id,
          `分页评论 ${i}`,
          new Date(2026, 0, 1, 0, 0, i),
        ],
      );
  });
  await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
  const comments = page.getByRole("region", { name: "评论", exact: true });
  await expect(comments.getByRole("listitem")).toHaveCount(30);
  await comments
    .getByRole("button", { name: "加载更多评论", exact: true })
    .click();
  await expect(comments.getByRole("listitem")).toHaveCount(35);
  await comments
    .getByRole("textbox", { name: "评论正文", exact: true })
    .fill("刷新时保留的草稿");
  const response = await request.post(`/api/v1/tasks/${task.id}/comments`, {
    headers: write(),
    data: { body: "另一个窗口的新评论" },
  });
  expect(response.status()).toBe(201);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(comments.getByRole("listitem")).toHaveCount(36);
  await expect(
    comments.getByRole("textbox", { name: "评论正文", exact: true }),
  ).toHaveValue("刷新时保留的草稿");
  await page.goto("/app/today");
  await expect(
    page.getByRole("heading", { name: "我的工作台", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "我的任务", exact: true })
      .getByText(task.title, { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "已完成", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "我的任务", exact: true })
      .getByText(task.title, { exact: true }),
  ).toHaveCount(0);
});

test("member task creator cannot delete owner comments or files and loses subresources after removal", async ({
  browser,
  request,
  baseURL,
}) => {
  const member = await browser.newContext({ baseURL });
  const meta: { email?: string } = {};
  try {
    try {
      await member.addCookies(
        await establishSessionCookies(member.request, baseURL!, meta),
      );
    } finally {
      if (meta.email) emails.push(meta.email);
    }
    let memberId = "";
    await withTestDb(async (db) => {
      memberId = (
        await db.query<{ id: string }>('SELECT id FROM "User" WHERE email=$1', [
          meta.email,
        ])
      ).rows[0]!.id;
      await db.query(
        'INSERT INTO "ProjectMember" (id,"projectId","userId","joinedAt") VALUES ($1,$2,$3,now())',
        [randomUUID(), project.id, memberId],
      );
      await db.query('UPDATE "Task" SET "creatorId"=$1 WHERE id=$2', [
        memberId,
        task.id,
      ]);
    });
    expect(
      (
        await request.post(`/api/v1/tasks/${task.id}/comments`, {
          headers: write(),
          data: { body: "所有者评论" },
        })
      ).status(),
    ).toBe(201);
    const data = Buffer.from("owner attachment");
    const form = {
      uploadId: randomUUID(),
      declaredSizeBytes: String(data.length),
      sha256: createHash("sha256").update(data).digest("hex"),
      file: { name: "owner.txt", mimeType: "text/plain", buffer: data },
    };
    expect(
      (
        await request.post(`/api/v1/tasks/${task.id}/attachments`, {
          headers: { origin },
          multipart: form,
        })
      ).status(),
    ).toBe(201);
    const page = await member.newPage();
    await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
    await expect(page.getByText("所有者评论", { exact: true })).toBeVisible();
    await expect(page.getByText("owner.txt", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "删除评论", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "删除附件", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "添加子任务", exact: true }),
    ).toBeEnabled();
    await withTestDb(async (db) => {
      await db.query(
        'DELETE FROM "ProjectMember" WHERE "projectId"=$1 AND "userId"=$2',
        [project.id, memberId],
      );
    });
    for (const resource of ["comments", "subtasks", "attachments"])
      expect(
        (
          await member.request.get(`/api/v1/tasks/${task.id}/${resource}`)
        ).status(),
      ).toBe(404);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText("所有者评论", { exact: true })).toHaveCount(0);
  } finally {
    await member.close();
  }
});

test("late subresource response cannot overwrite a newer focus refresh", async ({
  page,
  request,
}) => {
  await page.goto(`/app/projects/${project.id}/tasks/${task.id}`);
  const section = page.getByRole("region", { name: "子任务", exact: true });
  await expect(
    section.getByText("暂无子任务。", { exact: true }),
  ).toBeVisible();
  let release!: () => void, started!: () => void;
  const blocked = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      started = resolve;
    });
  let first = true;
  await page.route(`**/api/v1/tasks/${task.id}/subtasks`, async (route) => {
    if (route.request().method() !== "GET" || !first) return route.continue();
    first = false;
    const old = await route.fetch();
    started();
    await blocked;
    await route.fulfill({ response: old });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await ready;
  expect(
    (
      await request.post(`/api/v1/tasks/${task.id}/subtasks`, {
        headers: write(),
        data: { title: "较新响应中的子任务" },
      })
    ).status(),
  ).toBe(201);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    section.getByText("较新响应中的子任务", { exact: true }),
  ).toBeVisible();
  const oldResponse = page.waitForResponse((response) =>
    response.url().includes(`/tasks/${task.id}/subtasks`),
  );
  release();
  await oldResponse;
  await expect(
    section.getByText("较新响应中的子任务", { exact: true }),
  ).toBeVisible();
});

test("malformed HTTP multipart is rejected and the server remains healthy",async({request})=>{
 const response=await request.post(`/api/v1/tasks/${task.id}/attachments`,{headers:{origin},multipart:{file:{name:"x.txt",mimeType:"text/plain",buffer:Buffer.from("x")},uploadId:randomUUID(),declaredSizeBytes:"1",sha256:createHash("sha256").update("x").digest("hex")}});
 expect(response.status()).toBe(400);expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
 expect((await request.get("/api/v1/me")).status()).toBe(200);
 expect((await(await request.get(`/api/v1/tasks/${task.id}/attachments`)).json()).data).toEqual([]);
});
