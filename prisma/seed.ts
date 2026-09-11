import dotenv from "dotenv";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Prisma seed（命令：pnpm db:seed → prisma db seed → tsx prisma/seed.ts）。
 *
 * Prisma 7 不再自动加载 .env，也不在 migrate 时自动 seed（见官方 to-v7 指南）。
 * 这里显式加载约定环境文件（.env.local，回退 .env），与 Next / Prisma CLI 保持一致。
 *
 * M0 范围只有连接校验；M2 / ORB-009 起在连接校验之后追加**业务种子**：
 *  - 仅允许 APP_ENV=development/test 写种子（拒绝在 staging/production 播种）；
 *  - 全部用**稳定 fixture UUID + upsert**（幂等，重复运行不产生重复行、不清库）；
 *  - 日期用固定基准 `2026-09-01T00:00:00Z`（跨运行可复现，便于截图/断言）；
 *  - 绝不打印任何凭证（密码/token/连接串），只输出计数摘要；
 *  - 种子用户不建 Account/密码（业务种子只服务数据浏览与看板/列表开发，
 *    真实登录走注册流程或集成/E2E 夹具）。
 *
 * 连接或写入失败以非零码退出，不伪装成功。
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/* ── 稳定 fixture 标识（全部为确定性 UUID / TEXT，便于幂等 upsert）──────────── */

/** 允许播种的应用环境（AGENTS.md：不在生产库播种）。 */
const SEED_ALLOWED_ENVS = new Set(["development", "test"]);

/** 种子用户（TEXT id，与 Better Auth 的 cuid 同类型；这里用可读的稳定 id）。 */
const SEED_USER_ID = "seed-user-orbit-dev";
const SEED_USER_EMAIL = "seed@orbit.test";
const SEED_USER_NAME = "种子用户";
const SEED_USER_TIMEZONE = "Asia/Shanghai";

/** 活跃项目 A 与归档项目 B（@db.Uuid，须为合法 UUID 字面量）。 */
const PROJECT_A_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_A_KEY = "ORBITA";
const PROJECT_B_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_B_KEY = "ORBITB";

/** 固定基准日期：所有 createdAt/dueDate/completedAt 相对它偏移，保证可复现。 */
const BASE = new Date("2026-09-01T00:00:00Z");
/** 相对基准日 +n 天（UTC 午夜），用于 dueDate（DATE 列）与时间戳。 */
function day(offset: number): Date {
  return new Date(BASE.getTime() + offset * 86_400_000);
}

/** 由任务编号派生稳定 UUID（00000000-0000-4000-8000-0000000000NN）。 */
function taskId(number: number): string {
  return `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}
/** 由序号派生稳定活动 UUID（aaaaaaa0-0000-4000-8000-00000000NNNN）。 */
function activityId(seq: number): string {
  return `aaaaaaa0-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

/* ── 任务 fixture（项目 A，跨 TODO/IN_PROGRESS/DONE + 1 条软删除）──────────── */

type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type TaskPriority = "NONE" | "LOW" | "MEDIUM" | "HIGH";

interface TaskSeed {
  number: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** 相对基准日的 dueDate 偏移；null = 无截止日。 */
  dueOffset: number | null;
  /** 看板列内 position（bigint，间隔 1024 对齐 appendToColumnEnd）。 */
  position: bigint;
  /** 相对基准日的创建偏移。 */
  createdOffset: number;
  /** 是否软删除（进回收站）。 */
  deleted?: boolean;
}

const TASK_SEEDS: TaskSeed[] = [
  { number: 1, title: "梳理 onboarding 流程", description: "从注册到首个项目的完整路径。", status: "TODO", priority: "HIGH", dueOffset: 3, position: 1024n, createdOffset: 0 },
  { number: 2, title: "实现项目设置页", description: "名称/标识/标记色/归档。", status: "TODO", priority: "MEDIUM", dueOffset: null, position: 2048n, createdOffset: 0 },
  { number: 3, title: "编写数据模型迁移", description: "Project/Task/ActivityLog 三域。", status: "IN_PROGRESS", priority: "HIGH", dueOffset: 1, position: 1024n, createdOffset: 1 },
  { number: 4, title: "接入契约层 API 客户端", description: "createApiClient + 幂等键。", status: "IN_PROGRESS", priority: "MEDIUM", dueOffset: null, position: 2048n, createdOffset: 1 },
  { number: 5, title: "补充集成测试夹具", description: "vi.mock 绑定 orbit_test。", status: "DONE", priority: "LOW", dueOffset: null, position: 1024n, createdOffset: 2 },
  { number: 6, title: "修复登录页焦点环", description: "tokens.css 焦点环移出 @layer base。", status: "DONE", priority: "MEDIUM", dueOffset: null, position: 2048n, createdOffset: 2 },
  { number: 7, title: "设计空态插画", description: "项目/任务/回收站空态。", status: "TODO", priority: "NONE", dueOffset: 7, position: 3072n, createdOffset: 3 },
  { number: 8, title: "归档旧看板 fixture", description: "M0 样例数据隔离到 fixtures.ts。", status: "DONE", priority: "LOW", dueOffset: null, position: 3072n, createdOffset: 3 },
  // 软删除任务（回收站可见，看板/列表不可见）；仍遵守 DONE⇔completedAt 约束。
  { number: 9, title: "废弃的重复任务", description: "重复登记，已移入回收站。", status: "TODO", priority: "NONE", dueOffset: null, position: 4096n, createdOffset: 4, deleted: true },
];

/** 任务完成时刻（DONE 任务 completedAt 非空，满足 DB CHECK：DONE ⇔ completedAt）。 */
function completedAtFor(seed: TaskSeed): Date | null {
  return seed.status === "DONE" ? day(seed.createdOffset + 1) : null;
}

async function seedBusinessData(databaseUrl: string): Promise<void> {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });
  try {
    // 1) 种子用户（emailVerified，无密码 Account）——所有业务实体的 owner/creator/actor。
    await prisma.user.upsert({
      where: { email: SEED_USER_EMAIL },
      create: {
        id: SEED_USER_ID,
        name: SEED_USER_NAME,
        email: SEED_USER_EMAIL,
        emailVerified: true,
        timezone: SEED_USER_TIMEZONE,
        createdAt: BASE,
      },
      update: {
        name: SEED_USER_NAME,
        emailVerified: true,
        timezone: SEED_USER_TIMEZONE,
      },
    });
    // 若历史上以不同 id 建过同邮箱用户，取回真实 id 供外键使用。
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: SEED_USER_EMAIL },
      select: { id: true },
    });
    const ownerId = user.id;

    // 2) 项目 A（活跃）。nextTaskNumber = 最大任务号 + 1 = 10；boardVersion = 1 + 9 次看板写。
    await prisma.project.upsert({
      where: { key: PROJECT_A_KEY },
      create: {
        id: PROJECT_A_ID,
        ownerId,
        name: "Orbit 纵向闭环",
        key: PROJECT_A_KEY,
        description: "M2 种子项目：跨状态任务与看板顺序样例。",
        color: "BLUE",
        version: 1,
        boardVersion: 1 + TASK_SEEDS.length,
        nextTaskNumber: TASK_SEEDS.length + 1,
        createdAt: BASE,
      },
      update: {
        ownerId,
        name: "Orbit 纵向闭环",
        description: "M2 种子项目：跨状态任务与看板顺序样例。",
        color: "BLUE",
        archivedAt: null,
        nextTaskNumber: TASK_SEEDS.length + 1,
      },
    });
    // 取回真实 id（key 唯一，历史可能以不同 UUID 建过）。
    const projectA = await prisma.project.findUniqueOrThrow({
      where: { key: PROJECT_A_KEY },
      select: { id: true },
    });

    // 3) 项目 B（归档，无任务）。version=2 表示归档时 bump 过一次。
    await prisma.project.upsert({
      where: { key: PROJECT_B_KEY },
      create: {
        id: PROJECT_B_ID,
        ownerId,
        name: "已归档示例项目",
        key: PROJECT_B_KEY,
        description: "归档态只读示例（回收站/看板不显示新建入口）。",
        color: "GRAY",
        archivedAt: day(5),
        version: 2,
        boardVersion: 1,
        nextTaskNumber: 1,
        createdAt: BASE,
      },
      update: {
        ownerId,
        name: "已归档示例项目",
        description: "归档态只读示例（回收站/看板不显示新建入口）。",
        color: "GRAY",
        archivedAt: day(5),
      },
    });
    const projectB = await prisma.project.findUniqueOrThrow({
      where: { key: PROJECT_B_KEY },
      select: { id: true },
    });

    // 4) 任务（项目 A）：按 (projectId, number) 复合唯一 upsert。
    for (const seed of TASK_SEEDS) {
      const created = day(seed.createdOffset);
      const deletedAt = seed.deleted ? day(seed.createdOffset + 2) : null;
      const dueDate = seed.dueOffset === null ? null : day(seed.dueOffset);
      const completedAt = completedAtFor(seed);
      await prisma.task.upsert({
        where: { projectId_number: { projectId: projectA.id, number: seed.number } },
        create: {
          id: taskId(seed.number),
          projectId: projectA.id,
          number: seed.number,
          creatorId: ownerId,
          assigneeId: null,
          title: seed.title,
          description: seed.description,
          status: seed.status,
          priority: seed.priority,
          dueDate,
          position: seed.position,
          completedAt,
          version: 1,
          deletedAt,
          createdAt: created,
        },
        update: {
          creatorId: ownerId,
          title: seed.title,
          description: seed.description,
          status: seed.status,
          priority: seed.priority,
          dueDate,
          position: seed.position,
          completedAt,
          deletedAt,
        },
      });
    }

    // 5) ActivityLog（只追加语义；用稳定 UUID 幂等 upsert，避免重复运行产生重复事件）。
    //    metadata 遵守 writer.ts 白名单：只放 taskIdentifier 等允许字段。
    type ActivitySeed = {
      seq: number;
      projectId: string;
      entityType: "PROJECT" | "TASK";
      entityId: string;
      action:
        | "PROJECT_CREATED"
        | "PROJECT_ARCHIVED"
        | "TASK_CREATED"
        | "TASK_DELETED";
      metadata: Record<string, string>;
      createdOffset: number;
    };
    const activitySeeds: ActivitySeed[] = [
      { seq: 1, projectId: projectA.id, entityType: "PROJECT", entityId: projectA.id, action: "PROJECT_CREATED", metadata: {}, createdOffset: 0 },
      { seq: 2, projectId: projectB.id, entityType: "PROJECT", entityId: projectB.id, action: "PROJECT_CREATED", metadata: {}, createdOffset: 0 },
      { seq: 3, projectId: projectB.id, entityType: "PROJECT", entityId: projectB.id, action: "PROJECT_ARCHIVED", metadata: {}, createdOffset: 5 },
    ];
    TASK_SEEDS.forEach((seed, index) => {
      activitySeeds.push({
        seq: 10 + index,
        projectId: projectA.id,
        entityType: "TASK",
        entityId: taskId(seed.number),
        action: "TASK_CREATED",
        metadata: { taskIdentifier: `${PROJECT_A_KEY}-${seed.number}` },
        createdOffset: seed.createdOffset,
      });
    });
    // 软删除任务的 TASK_DELETED 事件。
    const deletedSeed = TASK_SEEDS.find((s) => s.deleted);
    if (deletedSeed) {
      activitySeeds.push({
        seq: 90,
        projectId: projectA.id,
        entityType: "TASK",
        entityId: taskId(deletedSeed.number),
        action: "TASK_DELETED",
        metadata: { taskIdentifier: `${PROJECT_A_KEY}-${deletedSeed.number}` },
        createdOffset: deletedSeed.createdOffset + 2,
      });
    }
    for (const activity of activitySeeds) {
      await prisma.activityLog.upsert({
        where: { id: activityId(activity.seq) },
        create: {
          id: activityId(activity.seq),
          projectId: activity.projectId,
          actorId: ownerId,
          entityType: activity.entityType,
          entityId: activity.entityId,
          action: activity.action,
          metadata: activity.metadata,
          createdAt: day(activity.createdOffset),
        },
        update: {
          projectId: activity.projectId,
          actorId: ownerId,
          entityType: activity.entityType,
          entityId: activity.entityId,
          action: activity.action,
          metadata: activity.metadata,
        },
      });
    }

    // 摘要（不含任何凭证）：确认写入规模。
    const projectCount = await prisma.project.count({ where: { ownerId } });
    const taskCount = await prisma.task.count({ where: { projectId: projectA.id } });
    const deletedCount = await prisma.task.count({
      where: { projectId: projectA.id, deletedAt: { not: null } },
    });
    const activityCount = await prisma.activityLog.count({
      where: { projectId: { in: [projectA.id, projectB.id] } },
    });
    console.log(
      `[seed] 业务种子完成（幂等 upsert）：用户 1（${SEED_USER_EMAIL}）· 项目 ${projectCount}` +
        `（活跃 ${PROJECT_A_KEY} + 归档 ${PROJECT_B_KEY}）· 任务 ${taskCount}（含软删除 ${deletedCount}）· 活动 ${activityCount}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[seed] 缺少 DATABASE_URL（请复制 .env.example 为 .env.local 并填写）。");
    process.exit(1);
  }

  // 连接校验（保留 M0 行为）：真实 SELECT，失败即非零退出。
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const result = await client.query("SELECT current_database() AS db, version() AS version");
    const row = result.rows[0];
    console.log(`[seed] 已连接目标库：${row?.db ?? "(unknown)"}`);
  } catch (error) {
    console.error("[seed] 连接数据库失败：", error instanceof Error ? error.message : error);
    process.exitCode = 1;
    throw error;
  } finally {
    await client.end();
  }

  // 环境闸门：仅在 development/test 播种，拒绝 staging/production。
  const appEnv = process.env.APP_ENV ?? "development";
  if (!SEED_ALLOWED_ENVS.has(appEnv)) {
    console.error(`[seed] 拒绝在 APP_ENV=${appEnv} 下播种（仅允许 development/test）。`);
    process.exit(1);
  }

  await seedBusinessData(databaseUrl);
}

void main();
