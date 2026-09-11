import { afterEach, describe, expect, it } from "vitest";
import {
  fromDueDateString,
  isValidDueDate,
  toDueDateString,
} from "@/server/modules/task/date-only";

/**
 * date-only 映射单元测试（M2 / ORB-008，docs/04 §1、docs/05 §2）。
 *
 * 核心不变量：Task.dueDate 是 PostgreSQL `date`，网络层为 "YYYY-MM-DD"。
 * 转换**必须与运行环境时区无关**——否则同一截止日在不同 TZ 的机器上会错一天。
 * 本测试在三档极端时区（UTC+8 / UTC+14 / UTC-11）下反复验证同一固定瞬间的
 * 往返结果完全一致，证明 toDueDateString/fromDueDateString 一律走 UTC。
 */

/** 三档极端时区：涵盖最大正偏移、最大负偏移与常见东区。 */
const EXTREME_ZONES = ["Asia/Shanghai", "Pacific/Kiritimati", "Pacific/Niue"] as const;

/** 原 TZ，测试结束后恢复，避免污染同进程其它用例。 */
const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("toDueDateString — Date→YYYY-MM-DD（UTC，无时区偏移）", () => {
  // 2026-03-04T05:06:07Z：在各极端 TZ 下本地日期可能是 03-03/03-04/03-05，
  // 但 UTC 日历日恒为 2026-03-04。
  const instant = new Date("2026-03-04T05:06:07.000Z");

  it("三档极端时区下均返回同一 UTC 日历日 2026-03-04", () => {
    for (const zone of EXTREME_ZONES) {
      process.env.TZ = zone;
      expect(toDueDateString(instant), `TZ=${zone}`).toBe("2026-03-04");
    }
  });

  it("UTC 午夜与临近日界（23:59:59Z）不跨天", () => {
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14：本地已是次日
    expect(toDueDateString(new Date("2026-03-04T00:00:00.000Z"))).toBe("2026-03-04");
    expect(toDueDateString(new Date("2026-03-04T23:59:59.999Z"))).toBe("2026-03-04");
    process.env.TZ = "Pacific/Niue"; // UTC-11：本地仍是前一日
    expect(toDueDateString(new Date("2026-03-04T00:00:00.000Z"))).toBe("2026-03-04");
    expect(toDueDateString(new Date("2026-03-04T23:59:59.999Z"))).toBe("2026-03-04");
  });

  it("年份补足 4 位（公元 <1000 年不塌缩）", () => {
    expect(toDueDateString(new Date(Date.UTC(999, 0, 5)))).toBe("0999-01-05");
  });
});

describe("fromDueDateString — YYYY-MM-DD→UTC 午夜（无时区偏移）", () => {
  it("三档极端时区下均构造出同一 UTC 午夜毫秒值", () => {
    const expected = Date.UTC(2026, 2, 4); // 2026-03-04T00:00:00.000Z
    for (const zone of EXTREME_ZONES) {
      process.env.TZ = zone;
      expect(fromDueDateString("2026-03-04").getTime(), `TZ=${zone}`).toBe(expected);
    }
  });

  it("往返一致：string→Date→string 在所有极端 TZ 下不变", () => {
    for (const zone of EXTREME_ZONES) {
      process.env.TZ = zone;
      expect(toDueDateString(fromDueDateString("2026-12-31")), `TZ=${zone}`).toBe("2026-12-31");
    }
  });

  it("非法格式抛 RangeError（防御脏值入库）", () => {
    expect(() => fromDueDateString("2026-3-4")).toThrow(RangeError);
    expect(() => fromDueDateString("2026-02-30")).toThrow(RangeError);
    expect(() => fromDueDateString("不是日期")).toThrow(RangeError);
  });
});

describe("isValidDueDate — date-only 字符串校验", () => {
  it("接受合法日历日", () => {
    expect(isValidDueDate("2026-01-01")).toBe(true);
    expect(isValidDueDate("2026-12-31")).toBe(true);
    expect(isValidDueDate("2024-02-29")).toBe(true); // 闰年
  });

  it("拒绝非法格式与不存在的日历日", () => {
    expect(isValidDueDate("2026-1-1")).toBe(false); // 未补零
    expect(isValidDueDate("2026-02-30")).toBe(false); // 2 月无 30 日
    expect(isValidDueDate("2026-13-01")).toBe(false); // 无 13 月
    expect(isValidDueDate("2026-00-10")).toBe(false); // 无 0 月
    expect(isValidDueDate("2023-02-29")).toBe(false); // 平年无 29 日
    expect(isValidDueDate("2026/01/01")).toBe(false); // 分隔符错误
    expect(isValidDueDate("")).toBe(false);
  });
});
