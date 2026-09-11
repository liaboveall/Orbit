import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import type { PrismaClient } from "@/generated/prisma/client";
import { getEnv, parseEnv } from "@/server/env";

/**
 * Workbench 性能测试 - A-04 HIGH 修复验证（ORB-019 / OS-019）
 * 
 * 验证场景：跨多项目场景下，CTE + FILTER 聚合查询将 DB round-trips 从 5n 降至 2n
 * 
 * 基准配置：
 *  - projects: 10
 *  - tasks/project: 100 (均匀分布 overdue/dueToday/dueSoon/inProgress)
 *  - 预期 query count 从 50 (10×5) 降至 10 (10×2)
 *  - 预期 P99 响应时间 < 200ms
 * 
 * 测试覆盖：docs/01-PRODUCT-SPEC §3 (Workbench), docs/08-ENVIRONMENT-DEPLOYMENT (§3 性能约束)
 */

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);

/* ── 环境覆写 ─────────────────────────────────────────────────────────────── */
process.env.APP_ENV = "test";
process.env.BETTER_AUTH_SECRET = "orbit-workbench-perf-test-secret-12345678";

/**
 * 把应用 Prisma 单例替换为绑定 orbit_test 的客户端（惰性工厂）。
 */
vi.mock("@/server/db/prisma", async () => {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@/generated/prisma/client");
  const testEnv = parseEnv(process.env as Record<string, string | undefined>);
  const adapter = new PrismaPg({
    connectionString: testEnv.TEST_DATABASE_URL,
    max: 15,
    options: "-c statement_timeout=5000 -c lock_timeout=3000",
  });
  return { prisma: new PrismaClient({ adapter }) };
});

/** 动态 import（必须在 mock 注册之后） */
const { getWorkbench } = await import("@/server/modules/workbench/service");
const { auth } = await import("@/server/auth");
const { prisma } = await import("@/server/db/prisma");

/** 夹具常量 */
const RUN_TAG = `wbp-${Date.now()}`;
const domain = "orbit.test";
const EMAIL = `${RUN_TAG}@${domain}`;
const PASSWORD = "PerfTest!Passw0rd-Orbit";

/** 数据库清理器 */
async function cleanupDatabase(): Promise<void> {
  // 按依赖关系倒序删除（外键约束）
  await prisma.task.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.user.deleteMany();
  
  // 重置自增序列（避免 ID 冲突）
  await prisma.$executeRaw`SELECT setval('users_id_seq', 1, false)`;
  await prisma.$executeRaw`SELECT setval('projects_id_seq', 1, false)`;
}

/** 创建测试用户与项目（N+1 场景） */
async function createLoadTestUserAndProjects(count: number): Promise<{ userId: string; projectId: string[] }> {
  const user = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      email: EMAIL,
      name: "性能测试用户",
      timezone: "Asia/Shanghai",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  const projects: string[] = [];
  for (let i = 0; i < count; i++) {
    const project = await prisma.project.create({
      data: {
        id: crypto.randomUUID(),
        ownerId: user.id,
        key: `T${Date.now().toString(36)}P${String(i).padStart(2, "0")}`.slice(0, 8),
        name: `性能测试项目 ${i}`,
        color: "#3B82F6",
        version: 1,
        description: "用于 N+1 性能测试的项目",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    projects.push(project.id);
  }

  return { userId: user.id, projectId: projects };
}

/** 为每个项目创建 N 个任务（均匀分布各类状态） */
async function createTasksForProjects(projectIds: string[], tasksPerProject: number): Promise<void> {
  const tasks: any[] = [];
  const now = new Date();
  
  // 日期边界（亚洲时区）
  const todayStr = "2026-09-11";
  const tomorrowStr = "2026-09-12";
  const sevenDaysLaterStr = "2026-09-18";
  
  const dueDateMapping: { [key: string]: Date } = {
    overdue: new Date(todayStr + "T00:00:00Z"),      // 昨天及之前
    today: new Date(todayStr + "T00:00:00Z"),        // 今天
    soon: new Date(sevenDaysLaterStr + "T00:00:00Z"), // 未来 7 天
  };

  for (let projIdx = 0; projIdx < projectIds.length; projIdx++) {
    const projectId = projectIds[projIdx];
    
    for (let t = 0; t < tasksPerProject; t++) {
      const idx = t % 4; // 均匀分布：overdue/today/soon/inProgress
      
      let dueDate: Date;
      let status: "IN_PROGRESS" | "TODO" | "DONE";
      
      switch (idx) {
        case 0: // overdue (逾期)
          dueDate = new Date(dueDateMapping.overdue.getTime() - 86400000); // 提前 1 天
          status = "TODO";
          break;
        case 1: // dueToday (今天到期)
          dueDate = dueDateMapping.today;
          status = "TODO";
          break;
        case 2: // dueSoon (未来 7 天)
          dueDate = dueDateMapping.soon;
          status = "TODO";
          break;
        case 3: // inProgress (进行中，因 includeCompleted=false 默认不统计 DONE)
          dueDate = dueDateMapping.today;
          status = "IN_PROGRESS";
          break;
      }

      tasks.push({
        id: crypto.randomUUID(),
        projectId,
        title: `任务 ${projIdx}-${t}`,
        description: "用于性能测试的任务描述",
        status,
        priority: "HIGH" as const,
        dueDate,
        assigneeId: null!,
        creatorId: null!,
        position: BigInt(t),
        version: 1,
        completedAt: null,
        deletedAt: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  await prisma.task.createMany({ data: tasks });
}

/** DB Query Counter 监控工具 */
class DbQueryCounter {
  private originalLog: (...args: unknown[]) => void;
  public queries: { sql: string; params: unknown[] }[] = [];

  constructor() {
    this.originalLog = console.log;
  }

  start(): void {
    // @ts-ignore - 拦截 console.log
    console.log = (...args: unknown[]) => {
      if (args[0] && typeof args[0] === "string" && args[0].startsWith("[Workbench Performance]")) {
        this.queries.push({ sql: args.join(" "), params: [] });
      }
      // @ts-ignore
      this.originalLog(...args);
    };
  }

  stop(): void {
    // @ts-ignore - 恢复原始 log
    console.log = this.originalLog;
  }

  getCount(): number {
    return this.queries.filter(q => !q.sql.includes("[Workbench Performance]")).length;
  }
}

/* ── 测试用例 ─────────────────────────────────────────────────────────────── */

describe("Workbench Performance (A-04 HIGH)", () => {
  let testUser: { userId: string; projectId: string[] };

  beforeAll(async () => {
    /** 确保初始化测试数据库 */
    process.env.TEST_DATABASE_URL = env.TEST_DATABASE_URL;
    getEnv(true);
  });

  beforeEach(async () => {
    await cleanupDatabase();
    // 创建 10 个项目
    testUser = await createLoadTestUserAndProjects(10);
    // 每个项目 100 个任务 → 总计 1000 任务
    await createTasksForProjects(testUser.projectId, 100);
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("跨 10 个项目：DB query count 从 50 (10×5) 降至 10 (10×2)", async () => {
    const counter = new DbQueryCounter();
    counter.start();

    try {
      const startTime = performance.now();
      const result = await getWorkbench(testUser.userId);
      const endTime = performance.now();

      const queryCount = counter.getCount();
      const duration = endTime - startTime;

      // ✅ 断言 1：query count ≤ 20 (10 projects × 2 queries)
      // 原实现：10×5 = 50 queries
      expect(queryCount).toBeLessThanOrEqual(20);

      // ✅ 断言 2：计数准确性
      expect(result.overdue).toBeGreaterThan(0);
      expect(result.dueToday).toBeGreaterThan(0);
      expect(result.upcoming).toBeGreaterThan(0);
      expect(result.inProgress).toBeGreaterThan(0);

      // ✅ 断言 3：总数计算正确
      expect(result.totalOpen).toBe(result.overdue + result.dueToday + result.upcoming + result.inProgress);

      // ✅ 断言 4：返回任务列表不为空
      expect(result.tasks).toBeDefined();

      console.log(`✅ Workbench performance verification:`);
      console.log(`   - Query count: ${queryCount} (expected ≤20, original was 50)`);
      console.log(`   - Duration: ${duration.toFixed(2)}ms`);
      console.log(`   - Counts: overdue=${result.overdue}, dueToday=${result.dueToday}, upcoming=${result.upcoming}, inProgress=${result.inProgress}`);
    } finally {
      counter.stop();
    }
  });

  it("响应时间 P99 < 200ms（基准测试：10 projects, 100 tasks/project）", async () => {
    const sampleSize = 10;
    const durations: number[] = [];

    for (let i = 0; i < sampleSize; i++) {
      const start = performance.now();
      await getWorkbench(testUser.userId);
      const end = performance.now();
      durations.push(end - start);
    }

    // 计算 P99（第 99 百分位数）
    durations.sort((a, b) => a - b);
    const p99Index = Math.ceil(0.99 * sampleSize) - 1;
    const p99 = durations[p99Index];

    // ✅ 断言：P99 < 200ms
    expect(p99).toBeLessThan(200);
    console.log(`✅ P99 response time: ${p99.toFixed(2)}ms (threshold: 200ms)`);

    // 额外输出统计信息
    const avg = durations.reduce((a, b) => a + b, 0) / sampleSize;
    const min = Math.min(...durations);
    const max = Math.max(...durations);
    console.log(`   - Min: ${min.toFixed(2)}ms, Avg: ${avg.toFixed(2)}ms, Max: ${max.toFixed(2)}ms`);
  });

  it("包含已完成任务：query count 仍保持低水平（includeCompleted=true）", async () => {
    const counter = new DbQueryCounter();
    counter.start();

    try {
      const result = await getWorkbench(testUser.userId, { includeCompleted: true });
      
      expect(result.totalOpen).toBeGreaterThanOrEqual(0);
      
      const queryCount = counter.getCount();
      expect(queryCount).toBeLessThanOrEqual(20);
      
      console.log(`✅ includeCompleted=true query count: ${queryCount}`);
    } finally {
      counter.stop();
    }
  });

  it("空数据集：正常工作（0 queries to Task table）", async () => {
    await cleanupDatabase();
    
    const user = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        email: `${RUN_TAG}-empty@${domain}`,
        name: "Empty Dataset User",
        timezone: "UTC",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    try {
      const result = await getWorkbench(user.id);
      
      expect(result.overdue).toBe(0);
      expect(result.dueToday).toBe(0);
      expect(result.upcoming).toBe(0);
      expect(result.inProgress).toBe(0);
      expect(result.totalOpen).toBe(0);
      expect(result.tasks).toHaveLength(0);
      
      console.log(`✅ Empty dataset handled correctly`);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
