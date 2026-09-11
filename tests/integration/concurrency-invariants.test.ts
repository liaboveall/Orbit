import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import {
  ErrorResponseSchema,
  ProjectSchema,
  SuccessResponseSchema,
  TaskSchema,
  type ErrorResponse,
  type ProjectDTO,
  type TaskDTO,
} from "@/contracts";
import { getEnv, parseEnv } from "@/server/env";
import { REQUEST_ID_HEADER } from "@/server/http/request-id";

/**
 * 并发不变量集成测试（M2 CodeReview 补充 / docs/07 T-TASK-02·03、T-PROJECT-01、Spec S5.7）。
 *
 * 与 task.test.ts / project.test.ts 同一套基础设施：在**独立测试库 orbit_test**
 * （TEST_DATABASE_URL）上直接调用 Next.js route handler（纯 `(Request, ctx?) => Response`），
 * 用 `Promise.all` 制造**真实并发**（连接池 max=15，锁串行化由领域服务在事务内完成），
 * 验证四条在竞态下必须成立的不变量：
 *
 *  1. 任务编号并发（S5.7）：同项目并发 createTask → number 集合恰为 {1..N}、identifier 互不相同、
 *     Project.nextTaskNumber === N+1、无重复编号（编号在 Project 行锁事务内 `UPDATE..RETURNING` 取号）；
 *  2. 版本冲突并发（T-TASK-02）：同任务同 expectedVersion 两个并发 PATCH → 恰一个 200(version++)、
 *     一个 409 VERSION_CONFLICT(currentVersion=新版本)、DB 只落地胜者的 title；
 *  3. 幂等并发（T-TASK-03）：同 Idempotency-Key + 同 body 并发 createTask → Task/ActivityLog/
 *     IdempotencyRecord 各只 1 行、所有响应 data.id 相同；
 *  4. 项目 key 并发唯一（T-PROJECT-01）：同 key 不同 Idempotency-Key 并发 createProject →
 *     恰一个 201、其余 409 PROJECT_KEY_TAKEN、该 key 只 1 行。
 *
 * ⚠️ 并发用例可能因锁超时(55P03)映射为 409 或触发有限重试；断言以「不变量」为核心
 *    （编号唯一且连续、只一行、配额/唯一约束不破），成功数以实际观测为准。
 *
 * ⚠️ 单例隔离（必须在动态 import 前）：vi.mock 绑定 TEST_DATABASE_URL + APP_ENV=test 关闭限流。
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);

/** 仅供测试的固定密钥（≥32），非任何真实凭证。 */
const TEST_SECRET = "orbit-integration-test-secret-0123456789";

/* ── 环境覆写：关闭限流 + 固定测试密钥（必须在动态 import 前）────────────── */
process.env.APP_ENV = "test";
process.env.BETTER_AUTH_SECRET = TEST_SECRET;
getEnv(true);

/**
 * 把应用 Prisma 单例替换为绑定 orbit_test 的客户端（惰性工厂，首次 import 时执行）。
 * 连接池 max=15：给并发/多事务留出余量，把竞争聚焦到**行锁**而非连接池。
 */
vi.mock("@/server/db/prisma", async () => {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { parseEnv: parseTestEnv } = await import("@/server/env");
  const testEnv = parseTestEnv(process.env as Record<string, string | undefined>);
  const adapter = new PrismaPg({
    connectionString: testEnv.TEST_DATABASE_URL,
    max: 15,
    options: "-c statement_timeout=5000 -c lock_timeout=3000",
  });
  return { prisma: new PrismaClient({ adapter }) };
});

/* ── 动态 import（必须在环境覆写与 vi.mock 注册之后）────────────────────── */
const projectsRoute = await import("@/app/api/v1/projects/route");
const tasksRoute = await import("@/app/api/v1/projects/[projectId]/tasks/route");
const taskRoute = await import("@/app/api/v1/tasks/[taskId]/route");
const { auth } = await import("@/server/auth");
const { prisma: testPrisma } = await import("@/server/db/prisma");

/* ── 夹具常量 ─────────────────────────────────────────────────────────── */

const RUN_TAG = `orbconc-${Date.now()}`;
const domain = "orbit.test";
const EMAIL_A = `${RUN_TAG}-a@${domain}`; // 主账户：项目 owner、并发发起者
const PASSWORD = "Str0ng!Passw0rd-OrbitTest";
const NAME_A = "并发主";

const BASE = `${env.BETTER_AUTH_URL}/api/v1`;
const TRUSTED_ORIGIN =
  env.AUTH_TRUSTED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0] ?? env.BETTER_AUTH_URL;

/** key 前缀：run 唯一，确保跨运行不撞 DB 全局唯一约束。 */
const KEY_PREFIX = `Z${Date.now().toString(36).slice(-4).toUpperCase()}`;
let keyCounter = 0;
/** 生成合法且本次运行内唯一的项目 key（`/^[A-Z][A-Z0-9]{1,7}$/`，≤8 位）。 */
function nextKey(): string {
  keyCounter += 1;
  return `${KEY_PREFIX}${String(keyCounter).padStart(2, "0")}`.slice(0, 8);
}

/* ── 信封校验器（strict，形状不合契约直接抛错）────────────────────────── */
const ProjectSuccess = SuccessResponseSchema(ProjectSchema);
const TaskSuccess = SuccessResponseSchema(TaskSchema);

/* ── 请求辅助 ─────────────────────────────────────────────────────────── */

interface ReqOptions {
  cookie?: string | null;
  body?: unknown;
  origin?: string | null;
  idempotencyKey?: string;
  requestId?: string;
}

function buildRequest(method: string, url: string, options: ReqOptions = {}): Request {
  const { cookie = null, body, origin = TRUSTED_ORIGIN, idempotencyKey, requestId } = options;
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (origin !== null) headers.set("origin", origin);
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  if (requestId) headers.set(REQUEST_ID_HEADER, requestId);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

function ctxProject(projectId: string): { params: Promise<{ projectId: string }> } {
  return { params: Promise.resolve({ projectId }) };
}
function ctxTask(taskId: string): { params: Promise<{ taskId: string }> } {
  return { params: Promise.resolve({ taskId }) };
}

async function readError(response: Response): Promise<ErrorResponse> {
  return ErrorResponseSchema.parse((await response.json()) as unknown);
}

/* ── 认证夹具 ─────────────────────────────────────────────────────────── */

async function signUpVerified(email: string, name: string): Promise<void> {
  await auth.api.signUpEmail({ body: { email, password: PASSWORD, name } });
  await testPrisma.user.update({ where: { email }, data: { emailVerified: true } });
}

async function signIn(email: string): Promise<string> {
  const res = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    asResponse: true,
  });
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter((c) => c.length > 0)
    .join("; ");
}

let cookieA = "";
let userAId = "";

/** 清理本 run 数据（FK onDelete: Restrict，须按 子→父 顺序删除；Task 先于 Project）。 */
async function cleanup(): Promise<void> {
  const users = await testPrisma.user.findMany({
    where: { email: { contains: RUN_TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  const projects = await testPrisma.project.findMany({
    where: { ownerId: { in: userIds } },
    select: { id: true },
  });
  const projectIds = projects.map((p) => p.id);
  await testPrisma.activityLog.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.idempotencyRecord.deleteMany({ where: { userId: { in: userIds } } });
  await testPrisma.task.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await testPrisma.user.deleteMany({ where: { id: { in: userIds } } });
  await testPrisma.verification.deleteMany({ where: { identifier: { contains: RUN_TAG } } });
}

beforeAll(async () => {
  await cleanup();
  await signUpVerified(EMAIL_A, NAME_A);
  cookieA = await signIn(EMAIL_A);
  expect(cookieA).toContain("session_token");
  const a = await testPrisma.user.findUniqueOrThrow({ where: { email: EMAIL_A } });
  userAId = a.id;
}, 120_000);

/**
 * 每个用例后重置项目/任务数据（保留用户/会话），使各用例彼此隔离，
 * 并避免跨用例累计撞上 MAX_ACTIVE_PROJECTS / MAX_OPEN_TASKS 配额。
 */
afterEach(async () => {
  if (userAId.length === 0) return;
  const projects = await testPrisma.project.findMany({
    where: { ownerId: userAId },
    select: { id: true },
  });
  const projectIds = projects.map((p) => p.id);
  await testPrisma.activityLog.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.idempotencyRecord.deleteMany({ where: { userId: userAId } });
  await testPrisma.task.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
  await testPrisma.project.deleteMany({ where: { id: { in: projectIds } } });
});

afterAll(async () => {
  await cleanup();
  await testPrisma.$disconnect();
});

/* ── 领域辅助 ─────────────────────────────────────────────────────────── */

/** POST /projects 创建项目并断言 201，返回 ProjectDTO。 */
async function createProjectOk(name: string): Promise<ProjectDTO> {
  const response = await projectsRoute.POST(
    buildRequest("POST", `${BASE}/projects`, {
      cookie: cookieA,
      body: { name, key: nextKey() },
      idempotencyKey: randomUUID(),
    }),
  );
  expect(response.status).toBe(201);
  return ProjectSuccess.parse((await response.json()) as unknown).data;
}

/** POST /projects/{id}/tasks 创建任务并断言 201，返回 TaskDTO。 */
async function createTaskOk(projectId: string, body: Record<string, unknown>): Promise<TaskDTO> {
  const response = await tasksRoute.POST(
    buildRequest("POST", `${BASE}/projects/${projectId}/tasks`, {
      cookie: cookieA,
      body,
      idempotencyKey: randomUUID(),
    }),
    ctxProject(projectId),
  );
  expect(response.status).toBe(201);
  return TaskSuccess.parse((await response.json()) as unknown).data;
}

/* ── 1. 任务编号并发（Spec S5.7）──────────────────────────────────────── */

describe("并发不变量 · 任务编号（S5.7）", () => {
  it("同项目并发 20 个 createTask（不同 Idempotency-Key）→ number 恰为 {1..20}、identifier 互不相同、nextTaskNumber===21", async () => {
    const project = await createProjectOk("编号并发项目");
    const TOTAL = 20;

    const responses = await Promise.all(
      Array.from({ length: TOTAL }, (_, i) =>
        tasksRoute.POST(
          buildRequest("POST", `${BASE}/projects/${project.id}/tasks`, {
            cookie: cookieA,
            body: { title: `并发任务 ${i}` },
            idempotencyKey: randomUUID(), // 各请求不同幂等键 → 各创建独立任务
          }),
          ctxProject(project.id),
        ),
      ),
    );

    const statuses = responses.map((r) => r.status);
    const bodies = (await Promise.all(responses.map((r) => r.json()))) as unknown[];

    // 成功者（201）与失败者（并发争用可能映射为 409/422 冲突类）分流。
    const created: TaskDTO[] = [];
    for (let i = 0; i < TOTAL; i += 1) {
      if (statuses[i] === 201) {
        created.push(TaskSuccess.parse(bodies[i]).data);
      } else {
        // 非成功者只允许是冲突类语义（409 版本/锁占用、422 配额），绝不能是 500。
        expect([409, 422]).toContain(statuses[i]);
      }
    }

    const successCount = created.length;
    // 核心不变量 1：所有成功编号互不相同。
    const numbers = created.map((t) => t.number);
    expect(new Set(numbers).size).toBe(successCount);
    // 核心不变量 2：编号集合恰为连续 {1..successCount}（无跳号、无重复）。
    expect([...numbers].sort((a, b) => a - b)).toEqual(
      Array.from({ length: successCount }, (_, i) => i + 1),
    );
    // 核心不变量 3：identifier（KEY-number）互不相同。
    const identifiers = created.map((t) => t.identifier);
    expect(new Set(identifiers).size).toBe(successCount);
    // 核心不变量 4：计数器 = 成功数 + 1（每个成功创建恰好推进 1）。
    const row = await testPrisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(row.nextTaskNumber).toBe(successCount + 1);
    // 落库任务数 == 成功数（无幽灵行）。
    expect(await testPrisma.task.count({ where: { projectId: project.id } })).toBe(successCount);

    // 环境稳定时应全部成功；如未全成功，上面的不变量仍须成立（并发争用被正确处理）。
    expect(successCount).toBe(TOTAL);
  }, 90_000);
});

/* ── 2. 版本冲突并发（docs/07 T-TASK-02）──────────────────────────────── */

describe("并发不变量 · 乐观版本冲突（T-TASK-02）", () => {
  it("同任务同 expectedVersion:1 两个并发 PATCH → 恰一个 200(version=2)、一个 409(currentVersion=2)、DB 落地胜者 title", async () => {
    const project = await createProjectOk("版本并发项目");
    const task = await createTaskOk(project.id, { title: "初始标题" });
    expect(task.version).toBe(1);

    const [r1, r2] = await Promise.all([
      taskRoute.PATCH(
        buildRequest("PATCH", `${BASE}/tasks/${task.id}`, {
          cookie: cookieA,
          body: { expectedVersion: 1, title: "标题甲" },
        }),
        ctxTask(task.id),
      ),
      taskRoute.PATCH(
        buildRequest("PATCH", `${BASE}/tasks/${task.id}`, {
          cookie: cookieA,
          body: { expectedVersion: 1, title: "标题乙" },
        }),
        ctxTask(task.id),
      ),
    ]);

    const statuses = [r1.status, r2.status];
    // 恰好一个成功、一个冲突（Project 行锁把两者串行化，后者读到已 bump 的 version）。
    expect(statuses.filter((s) => s === 200).length).toBe(1);
    expect(statuses.filter((s) => s === 409).length).toBe(1);

    const okRes = r1.status === 200 ? r1 : r2;
    const conflictRes = r1.status === 409 ? r1 : r2;

    const okData = TaskSuccess.parse((await okRes.json()) as unknown).data;
    expect(okData.version).toBe(2);
    expect(["标题甲", "标题乙"]).toContain(okData.title);

    const err = await readError(conflictRes);
    expect(err.error.code).toBe("VERSION_CONFLICT");
    expect(err.error.currentVersion).toBe(2);

    // 数据库只落地成功者的 title，version 恰为 2。
    const row = await testPrisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.version).toBe(2);
    expect(row.title).toBe(okData.title);
  }, 60_000);
});

/* ── 3. 幂等并发（docs/07 T-TASK-03）──────────────────────────────────── */

describe("并发不变量 · 幂等去重（T-TASK-03）", () => {
  it("同 Idempotency-Key + 同 body 并发 5 个 createTask → Task/活动/幂等记录各 1 行、所有 data.id 相同", async () => {
    const project = await createProjectOk("幂等并发项目");
    const N = 5;
    const idempotencyKey = randomUUID();
    const body = { title: "幂等并发任务" };

    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        tasksRoute.POST(
          buildRequest("POST", `${BASE}/projects/${project.id}/tasks`, {
            cookie: cookieA,
            body,
            idempotencyKey, // 全部相同 → 只应创建一次
          }),
          ctxProject(project.id),
        ),
      ),
    );

    const statuses = responses.map((r) => r.status);
    // 全部落在 {201 新建, 200 重放}；并发争用不允许 500。
    for (const s of statuses) expect([200, 201]).toContain(s);
    // 恰一个 201（首次真正创建），其余为 200（重放原结果）。
    expect(statuses.filter((s) => s === 201).length).toBe(1);

    const bodies = (await Promise.all(responses.map((r) => r.json()))) as unknown[];
    const ids = bodies.map((b) => TaskSuccess.parse(b).data.id);
    // 所有响应指向同一任务 id。
    expect(new Set(ids).size).toBe(1);

    // 数据库副作用恰好一次。
    expect(await testPrisma.task.count({ where: { projectId: project.id } })).toBe(1);
    expect(
      await testPrisma.activityLog.count({
        where: { projectId: project.id, action: "TASK_CREATED" },
      }),
    ).toBe(1);
    expect(
      await testPrisma.idempotencyRecord.count({
        where: {
          userId: userAId,
          method: "POST",
          routeKey: `POST /projects/${project.id}/tasks`,
          key: idempotencyKey,
        },
      }),
    ).toBe(1);
  }, 60_000);
});

/* ── 4. 项目 key 并发唯一（docs/07 T-PROJECT-01）──────────────────────── */

describe("并发不变量 · 项目 key 唯一（T-PROJECT-01）", () => {
  it("并发 5 个 createProject 用同一 key（不同 Idempotency-Key）→ 恰一个 201、其余 409 PROJECT_KEY_TAKEN、该 key 只 1 行", async () => {
    const key = nextKey();
    const N = 5;

    const responses = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        projectsRoute.POST(
          buildRequest("POST", `${BASE}/projects`, {
            cookie: cookieA,
            body: { name: `同 key 项目 ${i}`, key }, // 全部相同 key
            idempotencyKey: randomUUID(), // 各请求不同幂等键 → 不走重放，直撞唯一约束
          }),
        ),
      ),
    );

    const statuses = responses.map((r) => r.status);
    const bodies = (await Promise.all(responses.map((r) => r.json()))) as unknown[];

    // 恰一个成功创建（用户级行锁串行化，首个插入成功，其余撞唯一约束）。
    expect(statuses.filter((s) => s === 201).length).toBe(1);
    for (let i = 0; i < N; i += 1) {
      if (statuses[i] !== 201) {
        expect(statuses[i]).toBe(409);
        expect(ErrorResponseSchema.parse(bodies[i]).error.code).toBe("PROJECT_KEY_TAKEN");
      }
    }

    // 该 key 全局只 1 行。
    expect(await testPrisma.project.count({ where: { key } })).toBe(1);
  }, 60_000);
});
