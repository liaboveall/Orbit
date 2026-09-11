import { describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { POSITION_GAP } from "@/server/modules/limits";
import { appendToColumnEnd } from "@/server/modules/task/position";

/**
 * 看板 position 辅助单元测试（M2 / ORB-008，docs/04 §5）。
 *
 * appendToColumnEnd 只依赖 tx.$queryRaw 的返回行，不触碰真实数据库；
 * 用桩事务客户端注入「该列末项 position」的三种运行时形态（bigint / string / number），
 * 验证：空列 → POSITION_GAP；有任务 → max + POSITION_GAP，且宽类型归一正确。
 * （node-pg / driver adapter 对 int8 列返回类型不稳定，故必须覆盖三种形态。）
 */

/** 构造只返回固定行的桩事务客户端（$queryRaw 为 tagged-template，忽略入参）。 */
function stubTx(rows: unknown[]): Prisma.TransactionClient {
  return { $queryRaw: async () => rows } as unknown as Prisma.TransactionClient;
}

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

describe("appendToColumnEnd — 追加到列末尾的 position 计算", () => {
  it("空列（无未删除任务）→ POSITION_GAP（1024n）", async () => {
    const tx = stubTx([]);
    await expect(appendToColumnEnd(tx, PROJECT_ID, "TODO")).resolves.toBe(POSITION_GAP);
    expect(POSITION_GAP).toBe(1024n);
  });

  it("末项以 bigint 返回 → max + POSITION_GAP", async () => {
    const tx = stubTx([{ position: 5120n }]);
    await expect(appendToColumnEnd(tx, PROJECT_ID, "IN_PROGRESS")).resolves.toBe(6144n);
  });

  it("末项以 string 返回（node-pg int8 常见形态）→ 归一后 max + POSITION_GAP", async () => {
    const tx = stubTx([{ position: "5120" }]);
    await expect(appendToColumnEnd(tx, PROJECT_ID, "TODO")).resolves.toBe(6144n);
  });

  it("末项以 number 返回 → 归一后 max + POSITION_GAP", async () => {
    const tx = stubTx([{ position: 1024 }]);
    await expect(appendToColumnEnd(tx, PROJECT_ID, "DONE")).resolves.toBe(2048n);
  });

  it("末项 position 为 null（防御）→ 视作空列 POSITION_GAP", async () => {
    const tx = stubTx([{ position: null }]);
    await expect(appendToColumnEnd(tx, PROJECT_ID, "TODO")).resolves.toBe(POSITION_GAP);
  });

  it("大 position 不丢失精度（BigInt 全程无 Number 截断）", async () => {
    const big = 9_007_199_254_740_993n; // 超过 Number.MAX_SAFE_INTEGER
    const tx = stubTx([{ position: big.toString() }]);
    await expect(appendToColumnEnd(tx, PROJECT_ID, "TODO")).resolves.toBe(big + POSITION_GAP);
  });
});
