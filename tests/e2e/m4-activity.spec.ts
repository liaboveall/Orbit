import {
  test,
  expect,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import pg from "pg";
import {
  ProjectSchema,
  SuccessResponseSchema,
  type ProjectDTO,
} from "../../src/contracts";
import { establishSessionCookies } from "../ui/auth-setup";

/**
 * M4 / ORB-011 + ORB-007：项目活动时间线与归档/恢复 E2E（真实浏览器）。
 *
 * 覆盖任务 Part 4：
 *  1. owner 登录 → 打开项目活动页（h1「项目活动」）→ 校验既有动作已展示；
 *  2. 「加载更多」分页（首屏 30 条，注入合成活动使 hasMore=true → 点击追加 → 36 条后按钮消失）；
 *  3. 打开项目设置 → 归档项目（二次确认对话框）→ 校验只读态（按钮转「恢复项目」+ 只读提示）；
 *  4. 恢复项目（二次确认对话框）→ 校验回到可编辑态；
 *  5. 回到活动页 → 归档/恢复动作被记录（「归档了项目」「恢复了项目」可见）。
 *
 * 与 m3-workflows / m4-invitations / m4-members 同一套基础设施：establishSessionCookies 走
 * 真实注册 → Mailpit 验证 → autoSignIn 链路取得 session cookie 注入浏览器上下文；合成活动用
 * 原生 SQL 直接写入 **dev 库**（DATABASE_URL/orbit_dev）；数据副作用在 afterEach 精确回收。
 *
 * ⚠️ 运行前置：dev server + PostgreSQL(orbit_dev) + Mailpit 均需在线；否则用例失败（属预期）。
 * ⚠️ 活动页 <ol> 与侧栏 <ul> 同为 listitem 角色，故计数一律限定在 main 内的 ol > li。
 */

dotenv.config({ path: [".env.local", ".env"], quiet: true });
test.describe.configure({ mode: "serial" });

/** Better Auth 受信源：POST 端点 Origin 头须命中它（与 auth-setup 一致）。 */
const origin = process.env.E2E_AUTH_ORIGIN ?? "http://localhost:3000";

/** 首屏页大小（ActivityFeed / activity page 均为 30）。 */
const PAGE_SIZE = 30;

let project: ProjectDTO;
/** owner（User A）的 userId，注入合成活动时作为 actorId。 */
let ownerUserId = "";
/** 本次用例在库中留下的全部用户邮箱，afterEach 精确回收。 */
let createdEmails: string[] = [];

/** 连接 **本地 dev 库** 执行清理/注入（拒绝非本地或非 orbit_dev，避免误伤其它库）。 */
async function db<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const target = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(target.hostname) ||
    target.pathname !== "/orbit_dev"
  ) {
    throw new Error("M4 browser tests require the local development database");
  }
  const client = new pg.Client({ connectionString: target.href });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** 以当前会话经 API 创建项目（统一信封 → ProjectDTO）。 */
async function createProject(request: APIRequestContext, name: string): Promise<ProjectDTO> {
  const res = await request.post("/api/v1/projects", {
    headers: { origin, "Idempotency-Key": randomUUID() },
    data: { name, key: "M" + randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase() },
  });
  expect(res.status()).toBe(201);
  return SuccessResponseSchema(ProjectSchema).parse(await res.json()).data;
}

/**
 * 注入 count 条合成 TASK_CREATED 活动，createdAt 严格递增且晚于建项目时刻
 * （now()+n 秒），使它们在 DESC 时间线里排在 PROJECT_CREATED 之前。
 * 用于把活动总数顶过首屏 PAGE_SIZE，触发「加载更多」按钮。
 */
async function seedActivities(projectId: string, actorId: string, count: number): Promise<void> {
  await db((client) =>
    client
      .query(
        `INSERT INTO "ActivityLog" (id,"projectId","actorId","entityType","entityId",action,"createdAt")
         SELECT gen_random_uuid(),$1::uuid,$2,'TASK','synthetic-'||n,'TASK_CREATED',
                now() + (n || ' seconds')::interval
         FROM generate_series(1,$3::int) n`,
        [projectId, actorId, count],
      )
      .then(() => undefined),
  );
}

/** 回收本用例创建的用户及其从属数据（子 → 父；Invitation.createdById 为 Restrict，须先删）。 */
async function cleanupEmails(emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  await db(async (client) => {
    const users = await client.query('SELECT id FROM "User" WHERE email=ANY($1::text[])', [
      emails,
    ]);
    const ids = users.rows.map((r: { id: string }) => r.id);
    if (ids.length === 0) return;
    const projects = await client.query(
      'SELECT id FROM "Project" WHERE "ownerId"=ANY($1::text[])',
      [ids],
    );
    const pids = projects.rows.map((r: { id: string }) => r.id);
    await client.query('DELETE FROM "ActivityLog" WHERE "projectId"=ANY($1::uuid[])', [pids]);
    await client.query('DELETE FROM "IdempotencyRecord" WHERE "userId"=ANY($1::text[])', [ids]);
    await client.query('DELETE FROM "Invitation" WHERE "projectId"=ANY($1::uuid[])', [pids]);
    await client.query('DELETE FROM "Task" WHERE "projectId"=ANY($1::uuid[])', [pids]);
    await client.query(
      'DELETE FROM "ProjectMember" WHERE "projectId"=ANY($1::uuid[]) OR "userId"=ANY($2::text[])',
      [pids, ids],
    );
    await client.query('DELETE FROM "Project" WHERE id=ANY($1::uuid[])', [pids]);
    await client.query('DELETE FROM "User" WHERE id=ANY($1::text[])', [ids]);
  });
}

test.beforeEach(async ({ request, context, baseURL }) => {
  createdEmails = [];
  ownerUserId = "";
  const metaA: { email?: string } = {};
  const cookiesA = await establishSessionCookies(request, baseURL!, metaA);
  createdEmails.push(metaA.email!);
  await context.addCookies(cookiesA);
  const me = await request.get("/api/v1/me");
  expect(me.status()).toBe(200);
  ownerUserId = ((await me.json()) as { data: { id: string } }).data.id;
  project = await createProject(request, "M4 活动与归档项目");
});

test.afterEach(async () => {
  await cleanupEmails(createdEmails);
  createdEmails = [];
});

test("活动时间线：既有动作展示 + 「加载更多」分页追加", async ({ page }) => {
  test.setTimeout(300_000);

  // 注入 35 条合成活动：连同建项目的 PROJECT_CREATED 共 36 条（> 首屏 30）→ hasMore=true。
  await seedActivities(project.id, ownerUserId, 35);

  await page.goto(`/app/projects/${project.id}/activity`);
  await expect(page.getByRole("heading", { name: "项目活动", exact: true })).toBeVisible();

  // 活动时间线限定在 main 内的 ol > li（避开侧栏 <ul> 的 listitem）。
  const items = page.locator("main ol > li");
  await expect(items).toHaveCount(PAGE_SIZE);

  // 「加载更多」按钮可见 → 点击后追加余下 6 条（36 条），按钮随之消失。
  const loadMore = page.getByRole("button", { name: "加载更多", exact: true });
  await expect(loadMore).toBeVisible();
  await loadMore.click();
  await expect(items).toHaveCount(36);
  await expect(loadMore).toHaveCount(0);

  // 全部加载后，最旧的「创建了项目」（PROJECT_CREATED）出现在时间线末尾。
  await expect(page.getByText("创建了项目", { exact: true }).first()).toBeVisible();
});

test("项目归档与恢复：设置页二次确认 + 只读态切换 + 活动留痕", async ({ page }) => {
  test.setTimeout(300_000);

  /* ── 归档项目 ─────────────────────────────────────────────────────── */
  await page.goto(`/app/projects/${project.id}/settings`);
  await expect(page.getByRole("heading", { name: "项目设置", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "归档项目", exact: true }).click();
  const archiveDialog = page.getByRole("dialog", { name: "归档项目" });
  await expect(archiveDialog).toBeVisible();
  await archiveDialog.getByRole("button", { name: "确认归档", exact: true }).click();

  // 归档后进入只读态：按钮转「恢复项目」，资料区显示只读提示。
  await expect(
    page.getByRole("button", { name: "恢复项目", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("项目已归档，处于只读状态。恢复项目后才能编辑资料。", { exact: true }),
  ).toBeVisible();

  /* ── 恢复项目 ─────────────────────────────────────────────────────── */
  await page.getByRole("button", { name: "恢复项目", exact: true }).click();
  const restoreDialog = page.getByRole("dialog", { name: "恢复项目" });
  await expect(restoreDialog).toBeVisible();
  await restoreDialog.getByRole("button", { name: "确认恢复", exact: true }).click();

  // 恢复后回到可编辑态：按钮转回「归档项目」，只读提示消失。
  await expect(
    page.getByRole("button", { name: "归档项目", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("项目已归档，处于只读状态。恢复项目后才能编辑资料。", { exact: true }),
  ).toHaveCount(0);

  /* ── 活动留痕：归档/恢复动作被记录 ─────────────────────────────────── */
  await page.goto(`/app/projects/${project.id}/activity`);
  await expect(page.getByRole("heading", { name: "项目活动", exact: true })).toBeVisible();
  await expect(page.getByText("归档了项目", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("恢复了项目", { exact: true }).first()).toBeVisible();
});
