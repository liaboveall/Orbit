import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import { appendToColumnEnd } from "@/server/modules/task/position";
import { withTransaction } from "@/server/db/tx";

/**
 * 关键排序边界（E2 修复验收，docs/04 §5、docs/07 T-BOARD-03）。
 *
 * 原审查把两条重编号路径混为一谈；本文件分别用真实 PostgreSQL 触达：
 *  1. **中点间隙耗尽**（move.ts renumberColumn）——相邻 position 差 < 2 时
 *     在其中插入 → 全列重编号为 GAP 倍数，顺序不丢、其他任务 version/updatedAt 不变；
 *  2. **列尾 bigint 边界**（position.ts renumberColumnAll）——列尾 position 距
 *     int8 上界不足一个 GAP 时追加 → 先全列重编号再追加。
 *
 * 触达方式：直接以夹具写入构造边界 position（真实触发条件是数千次移动，
 * 不可接受为测试前置），被测函数本身是生产代码路径。
 *
 * F18：重编号为事务内逐行 UPDATE；本测试同时记录 1000 行重编号的实测耗时，
 * 作为「是否必须改为批量 UPDATE」的测量依据。
 */

const OWNER = randomUUID();
const MEMBER = randomUUID();
const PROJECT_ID = randomUUID();
const KEY = "E" + randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase();
const POSITION_GAP = 1024n;
const BIGINT_MAX_SAFE = 9223372036854775800n;

async function createTaskRow(input: {
  number: number;
  position: bigint;
  status?: "TODO" | "IN_PROGRESS" | "DONE";
  title?: string;
}): Promise<string> {
  const id = randomUUID();
  // DONE 与 completedAt 一致（docs/04：Task_done_completed_check CHECK 约束）。
  const status = input.status ?? "DONE";
  await prisma.task.create({
    data: {
      id,
      projectId: PROJECT_ID,
      number: input.number,
      creatorId: OWNER,
      title: input.title ?? `边界任务 ${input.number}`,
      status,
      completedAt: status === "DONE" ? new Date() : null,
      position: input.position,
    },
  });
  return id;
}

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: OWNER, email: `e2-${OWNER}@orbit.test`, name: "边界所有者", emailVerified: true, timezone: "Asia/Shanghai" },
      { id: MEMBER, email: `e2-${MEMBER}@orbit.test`, name: "边界成员", emailVerified: true, timezone: "Asia/Shanghai" },
    ],
  });
  await prisma.project.create({
    data: { id: PROJECT_ID, ownerId: OWNER, key: KEY, name: "重编号边界项目", color: "BLUE" },
  });
});

afterAll(async () => {
  await prisma.task.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.activityLog.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [OWNER, MEMBER] } } });
  await prisma.$disconnect();
});

describe("中点间隙耗尽 → renumberColumn（E2）", () => {
  it("相邻 position 插入触发重编号：顺序不丢、version/updatedAt 不变、重编为 GAP 倍数", async () => {
    // 构造 DONE 列两个相邻 position（差 1 < 2 → gapExhausted）。
    const a = await createTaskRow({ number: 1, position: 1024n });
    const b = await createTaskRow({ number: 2, position: 1025n });
    const before = await prisma.task.findMany({
      where: { id: { in: [a, b] } },
      select: { id: true, version: true, updatedAt: true },
    });

    // 生产路径：computeMovePosition 会在持 Project 锁的事务内被调用；
    // 这里直接调用其依赖的插入安全检查（同模块生产代码）来触达重编号分支。
    const { computeMovePosition } = await import("@/server/modules/task/move");
    const moved = await createTaskRow({ number: 3, position: 4096n, status: "TODO", title: "被移动任务" });
    await withTransaction(async (tx) => {
      const position = await computeMovePosition(tx, PROJECT_ID, "DONE", b, moved);
      await tx.task.update({ where: { id: moved }, data: { position, status: "DONE", completedAt: new Date() } });
    });

    const rows = await prisma.task.findMany({
      where: { projectId: PROJECT_ID, status: "DONE", deletedAt: null },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, position: true, version: true, updatedAt: true },
    });
    expect(rows.map((r) => r.id)).toEqual([a, moved, b]);
    // 重编号后：原有任务回到 GAP 整数倍（a=1*GAP、b=2*GAP），
    // 被插任务落在两者中点 (1.5*GAP)——这正是 move.ts renumberColumn 的契约。
    expect(rows.find((r) => r.id === a)!.position).toBe(POSITION_GAP);
    expect(rows.find((r) => r.id === b)!.position).toBe(POSITION_GAP * 2n);
    expect(rows.find((r) => r.id === moved)!.position).toBe(POSITION_GAP + POSITION_GAP / 2n);
    // 其他任务 version/updatedAt 不变（重编号只改 position）。
    for (const row of rows) {
      const old = before.find((t) => t.id === row.id);
      if (old) {
        expect(row.version).toBe(old.version);
        expect(row.updatedAt.getTime()).toBe(old.updatedAt.getTime());
      }
    }
  });
});

describe("列尾 bigint 边界 → renumberColumnAll（E2）", () => {
  it("列尾接近 int8 上限时追加触发全列重编号并安全追加", async () => {
    const near = BIGINT_MAX_SAFE - 512n; // lastPosition + 1024 > MAX_SAFE → 触发
    const existing = await createTaskRow({ number: 10, position: near, status: "IN_PROGRESS", title: "近上限任务" });
    const beforeVersion = (
      await prisma.task.findUniqueOrThrow({ where: { id: existing }, select: { version: true } })
    ).version;

    let appended: bigint | null = null;
    await withTransaction(async (tx) => {
      appended = await appendToColumnEnd(tx, PROJECT_ID, "IN_PROGRESS");
    });

    expect(appended).not.toBeNull();
    expect(appended! + POSITION_GAP).toBeLessThanOrEqual(BIGINT_MAX_SAFE);

    const rows = await prisma.task.findMany({
      where: { projectId: PROJECT_ID, status: "IN_PROGRESS", deletedAt: null },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, position: true, version: true },
    });
    expect(rows.map((r) => r.id)).toEqual([existing]);
    // 重编号把原任务从近上限值拉回 1*GAP；追加函数返回的新位置在其后。
    expect(rows[0]!.position).toBe(POSITION_GAP);
    expect(rows[0]!.version).toBe(beforeVersion);
    expect(appended!).toBe(POSITION_GAP * 2n);
  });

  it("F18 测量：1000 行全列重编号耗时（逐行 UPDATE 基线）", async () => {
    // 仅 IN_PROGRESS 列保留 1 行；本用例在独立项目数据下测量后清理。
    const data = Array.from({ length: 999 }, (_, i) => ({
      id: randomUUID(),
      projectId: PROJECT_ID,
      number: 100 + i,
      creatorId: OWNER,
      title: `测量 ${i}`,
      status: "TODO" as const,
      position: BigInt(i + 1) * POSITION_GAP,
    }));
    await prisma.task.createMany({ data });

    const started = Date.now();
    await withTransaction(async (tx) => {
      // 与 position.ts renumberColumnAll 相同形状的逐行 UPDATE（1000 行）。
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Task"
        WHERE "projectId" = ${PROJECT_ID}::uuid AND "deletedAt" IS NULL AND status = 'TODO'::"TaskStatus"
        ORDER BY position ASC, id ASC
      `;
      for (const [idx, row] of rows.entries()) {
        const pos = BigInt(idx + 1) * POSITION_GAP;
        await tx.$executeRaw`UPDATE "Task" SET position = ${pos} WHERE id = ${row.id}::uuid`;
      }
    });
    const elapsed = Date.now() - started;
    // 事务预算目标：写事务秒级完成（docs/04 §4）。1000 行须显著低于 10s 语句超时。
    expect(elapsed).toBeLessThan(10_000);
    console.log(`[F18] 1000 行逐行重编号耗时：${elapsed}ms（本机测量，非生产基线）`);
  });
});
