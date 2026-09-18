import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  ERROR_CODES_BY_STATUS,
  ERROR_CODE_STATUS,
  ErrorCodeSchema,
  HTTP_ERROR_STATUSES,
  httpStatusForErrorCode,
  isErrorCode,
} from "@/contracts";

/**
 * 错误码契约测试（ORB-003）。
 * 权威来源：docs/05-API-CONTRACT.md §3 错误码全表。
 * 该表在运行时从文档解析，不在此处手抄：文档或实现任一侧漂移都会失败。
 */

const DOC_PATH = resolve(process.cwd(), "docs/05-API-CONTRACT.md");

/** 从 docs/05 §3 的 Markdown 表格解析 HTTP → code[] 映射。 */
function parseDocTable(): Record<number, string[]> {
  const content = readFileSync(DOC_PATH, "utf8");
  const table: Record<number, string[]> = {};
  const section = content.split(/##\s*3\.\s*错误码/)[1]?.split(/##\s*4\./)[0] ?? "";
  for (const line of section.split("\n")) {
    // 行形如：| 409 | VERSION_CONFLICT / BOARD_CONFLICT | 保留草稿/回滚，重新获取 |
    const match = line.match(/^\|\s*(\d{3})\s*\|\s*([A-Z_/\s]+?)\s*\|/);
    if (!match) continue;
    const status = Number(match[1]);
    const codes = match[2]!.split("/").map((code) => code.trim()).filter(Boolean);
    (table[status] ??= []).push(...codes);
  }
  if (Object.keys(table).length === 0) throw new Error("未能从 docs/05 §3 解析出错误码表；检查文档格式");
  return table;
}

const DOC_05_TABLE = parseDocTable();

describe("错误码 ↔ docs/05 §3 全表", () => {
  const docCodes = Object.values(DOC_05_TABLE).flat();

  it("覆盖表中全部错误码，且无多余码", () => {
    expect([...ERROR_CODES].sort()).toEqual([...docCodes].sort());
    expect(ERROR_CODES.length).toBe(docCodes.length);
  });

  it("每个错误码映射到表中对应的 HTTP 状态码", () => {
    for (const [statusText, codes] of Object.entries(DOC_05_TABLE)) {
      const status = Number(statusText);
      for (const code of codes) {
        expect(ERROR_CODE_STATUS[code as keyof typeof ERROR_CODE_STATUS]).toBe(status);
      }
    }
  });

  it("ERROR_CODE_STATUS 的键集与 ERROR_CODES 完全一致", () => {
    expect(Object.keys(ERROR_CODE_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });

  it("ERROR_CODES_BY_STATUS 分组与 ERROR_CODE_STATUS 一致（交叉校验）", () => {
    for (const [statusText, codes] of Object.entries(ERROR_CODES_BY_STATUS)) {
      const status = Number(statusText);
      expect(HTTP_ERROR_STATUSES).toContain(status as (typeof HTTP_ERROR_STATUSES)[number]);
      for (const code of codes) {
        expect(ERROR_CODE_STATUS[code]).toBe(status);
      }
    }
    // 分组视图应覆盖全部错误码。
    const grouped = Object.values(ERROR_CODES_BY_STATUS).flat();
    expect([...grouped].sort()).toEqual([...ERROR_CODES].sort());
  });

  it("httpStatusForErrorCode 返回正确状态码", () => {
    expect(httpStatusForErrorCode("NOT_FOUND")).toBe(404);
    expect(httpStatusForErrorCode("VERSION_CONFLICT")).toBe(409);
    expect(httpStatusForErrorCode("RATE_LIMITED")).toBe(429);
    expect(httpStatusForErrorCode("INTERNAL_ERROR")).toBe(500);
    expect(httpStatusForErrorCode("STORAGE_UNAVAILABLE")).toBe(503);
  });
});

describe("ErrorCodeSchema / isErrorCode", () => {
  it("接受全部已定义错误码", () => {
    for (const code of ERROR_CODES) {
      expect(ErrorCodeSchema.safeParse(code).success).toBe(true);
      expect(isErrorCode(code)).toBe(true);
    }
  });

  it("拒绝未定义的错误码字符串", () => {
    expect(ErrorCodeSchema.safeParse("NOT_A_CODE").success).toBe(false);
    expect(isErrorCode("NOT_A_CODE")).toBe(false);
    expect(isErrorCode("")).toBe(false);
  });
});
