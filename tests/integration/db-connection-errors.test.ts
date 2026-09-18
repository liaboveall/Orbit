import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import dotenv from "dotenv";
import { parseEnv } from "@/server/env";
import { isDatabaseUnavailableError } from "@/server/db/connection-errors";
import { toErrorResponse } from "@/server/http/errors";

/**
 * 数据库连接/池异常 → HTTP 状态映射（D2 修复验收，docs/03 §8、docs/05 §3）。
 *
 * 用真实 PostgreSQL（orbit_test）复现：
 *  - 小池耗尽（max=1，唯一连接被占用）→ pg-pool 等待超时（无 code 的裸 Error）→ 503；
 *  - 连接拒绝（错误端口）→ ECONNREFUSED → 503；
 *  - 释放后恢复 → 正常查询；
 *  - 未知编程错误 → 仍 500（不得把所有 Error 都当服务不可用）。
 *  - P2037 用例为**合成错误**（只验证映射分支，未人为耗尽 PG 全局连接上限）。
 *
 * 本文件只读（SELECT 1 / 连接控制），不写业务数据，不影响两库内容指纹。
 */

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);

/** 极小等待预算：仅用于快速复现池等待超时，不代表生产池配置。 */
const PROBE_POOL_TIMEOUT_MS = 300;

async function statusOf(error: unknown): Promise<{ status: number; code: string }> {
  const response = toErrorResponse(error, "d2-probe");
  const body = (await response.json()) as { error?: { code?: string } };
  return { status: response.status, code: body.error?.code ?? "" };
}

describe("数据库连接错误映射（D2）", () => {
  it("真实小池耗尽：pg-pool 等待超时的无code Error → 503 SERVICE_UNAVAILABLE", async () => {
    const pool = new Pool({
      connectionString: env.TEST_DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: PROBE_POOL_TIMEOUT_MS,
    });
    const holder = await pool.connect();
    try {
      let exhausted: unknown;
      try {
        await pool.query("SELECT 1");
        expect.unreachable("池耗尽应超时失败");
      } catch (error) {
        exhausted = error;
      }
      // 修复前：该错误无 code，直接落 500。修复后按已知形状识别为 503。
      expect(exhausted).toBeInstanceOf(Error);
      expect((exhausted as { code?: string }).code).toBeUndefined();
      expect(isDatabaseUnavailableError(exhausted)).toBe(true);
      expect(await statusOf(exhausted)).toEqual({ status: 503, code: "SERVICE_UNAVAILABLE" });
    } finally {
      holder.release();
      await pool.end();
    }
  });

  it("池释放后恢复：同一池继续正常服务", async () => {
    const pool = new Pool({
      connectionString: env.TEST_DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: PROBE_POOL_TIMEOUT_MS,
    });
    try {
      const holder = await pool.connect();
      try {
        await expect(pool.query("SELECT 1")).rejects.toBeInstanceOf(Error);
      } finally {
        holder.release();
      }
      const recovered = await pool.query("SELECT 1 AS ok");
      expect(recovered.rows[0]?.ok).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it("连接拒绝（不存在的端口）→ ECONNREFUSED → 503", async () => {
    const url = new URL(env.TEST_DATABASE_URL);
    url.port = "1"; // 本机几乎必然无服务
    const pool = new Pool({
      connectionString: url.toString(),
      max: 1,
      connectionTimeoutMillis: 2000,
    });
    try {
      let refused: unknown;
      try {
        await pool.query("SELECT 1");
        expect.unreachable("连接拒绝应失败");
      } catch (error) {
        refused = error;
      }
      expect(isDatabaseUnavailableError(refused)).toBe(true);
      expect(await statusOf(refused)).toEqual({ status: 503, code: "SERVICE_UNAVAILABLE" });
    } finally {
      await pool.end().catch(() => undefined);
    }
  });

  it("未知编程错误 → 仍 500 INTERNAL_ERROR（不扩大服务不可用范围）", async () => {
    expect(await statusOf(new Error("unexpected programming bug"))).toEqual({
      status: 500,
      code: "INTERNAL_ERROR",
    });
    // P2028 是事务回滚（通常是编程问题），明确不映射 503。
    const p2028 = Object.assign(new Error("Transaction aborted"), { code: "P2028" });
    expect(await statusOf(p2028)).toEqual({ status: 500, code: "INTERNAL_ERROR" });
  });

  it("合成 P2037 / P2024 / cause 链 ECONNRESET → 503（合成验证，注明非 PG 上限实测）", async () => {
    // 注：P2037 用例为合成错误对象，仅验证映射分支；未人为耗尽数据库全局连接上限。
    const synthetic = Object.assign(new Error("Too many database connections opened"), {
      code: "P2037",
    });
    expect(await statusOf(synthetic)).toEqual({ status: 503, code: "SERVICE_UNAVAILABLE" });

    const p2024 = Object.assign(new Error("Timed out fetching a new connection"), {
      code: "P2024",
    });
    expect(await statusOf(p2024)).toEqual({ status: 503, code: "SERVICE_UNAVAILABLE" });

    const wrapped = new Error("query failed", {
      cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    });
    expect(isDatabaseUnavailableError(wrapped)).toBe(true);
  });
});

afterAll(async () => {
  // 无持久资源；保留钩子以对齐套件结构。
});
