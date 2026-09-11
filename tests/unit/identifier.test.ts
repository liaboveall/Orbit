import { describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { DomainError } from "@/server/http/errors";
import { formatIdentifier, nextTaskNumber } from "@/server/modules/task/identifier";

/**
 * 任务编号辅助单元测试（M2 / ORB-008，docs/01 §6、docs/04 §3/§4）。
 *
 *  - formatIdentifier：纯函数，拼装 `${projectKey}-${number}`；
 *  - nextTaskNumber：只依赖 tx.$queryRaw 的 `UPDATE ... RETURNING` 结果行，用桩客户端注入，
 *    验证返回**本次分配**的编号（递增前原值），以及项目行缺失时的兜底 404。
 */

/** 构造只返回固定行的桩事务客户端（$queryRaw 为 tagged-template，忽略入参）。 */
function stubTx(rows: unknown[]): Prisma.TransactionClient {
  return { $queryRaw: async () => rows } as unknown as Prisma.TransactionClient;
}

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

describe("formatIdentifier — 任务标识符格式化", () => {
  it("`${projectKey}-${number}`", () => {
    expect(formatIdentifier("ORB", 1)).toBe("ORB-1");
    expect(formatIdentifier("ORB", 12)).toBe("ORB-12");
    expect(formatIdentifier("WEBAPP", 128)).toBe("WEBAPP-128");
  });
});

describe("nextTaskNumber — 锁内取号并递增", () => {
  it("返回 RETURNING 的 assigned（递增前的原值）", async () => {
    const tx = stubTx([{ assigned: 7 }]);
    await expect(nextTaskNumber(tx, PROJECT_ID)).resolves.toBe(7);
  });

  it("首个任务编号为 1", async () => {
    const tx = stubTx([{ assigned: 1 }]);
    await expect(nextTaskNumber(tx, PROJECT_ID)).resolves.toBe(1);
  });

  it("assigned 以字符串/BigInt 形态返回时归一为 number", async () => {
    await expect(nextTaskNumber(stubTx([{ assigned: "42" }]), PROJECT_ID)).resolves.toBe(42);
    await expect(nextTaskNumber(stubTx([{ assigned: 42n }]), PROJECT_ID)).resolves.toBe(42);
  });

  it("项目行缺失（UPDATE 命中 0 行）→ NOT_FOUND 兜底", async () => {
    const tx = stubTx([]);
    await expect(nextTaskNumber(tx, PROJECT_ID)).rejects.toBeInstanceOf(DomainError);
    await expect(nextTaskNumber(tx, PROJECT_ID)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
