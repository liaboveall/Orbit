import { describe, expect, it } from "vitest";
import { isValidTimezone, TIMEZONE_INVALID_MESSAGE } from "@/server/me/timezone";
import {
  COMMON_TIMEZONES,
  buildTimezoneOptions,
  describeZoneDifference,
  deviceTimezone,
  filterTimezoneOptions,
  isKnownTimezone,
  supportedTimezones,
  toTimezoneOption,
  zoneClock,
  zoneDateLabel,
  zoneDayProgress,
  zoneOffsetLabel,
  zoneOffsetMinutes,
  type TimezoneOption,
} from "@/features/settings/timezones";

/**
 * 时区校验与格式化工具单元测试（M1 / ORB-006）。
 *
 * 覆盖两层：
 *  1. **服务端权威校验** `src/server/me/timezone.ts`（PATCH /me 落库前的裁决者）——
 *     纯函数，不触库、不读 env，因此可安全放在 unit 项目里。
 *  2. **客户端预校验/展示** `src/features/settings/timezones.ts`（features 层，客户端安全，
 *     不导入 @/server）——提交前即时反馈，语义与服务端一致但最终裁决在服务端。
 *
 * 判定基准：ICU（`Intl.DateTimeFormat`）是运行时权威时区数据库。所有断言都基于
 * 固定瞬间（显式 Date）以保证与运行机器所在时区、夏令时无关，测试可重复。
 */

/* ── 固定瞬间（避免依赖运行环境时区） ───────────────────────────────────── */

/** 北半球冬季：纽约 EST(-05:00)、上海 +08:00（无夏令时）。 */
const WINTER = new Date("2026-01-15T00:00:00.000Z");
/** 北半球夏季：纽约 EDT(-04:00)，用于验证夏令时偏移随时刻变化。 */
const SUMMER = new Date("2026-07-15T00:00:00.000Z");
/** 12:00 UTC —— 一天进度恰好 0.5（UTC 时区下）。 */
const NOON_UTC = new Date("2026-01-15T12:00:00.000Z");

/* ── 1. 服务端权威校验 isValidTimezone ─────────────────────────────────── */

describe("isValidTimezone（服务端 IANA 裁决）", () => {
  it("接受标准 IANA 标识（含大区/城市、Etc/*、UTC/GMT）", () => {
    for (const zone of [
      "Asia/Shanghai",
      "Asia/Kathmandu",
      "Europe/Berlin",
      "America/New_York",
      "America/Argentina/Buenos_Aires",
      "Australia/Sydney",
      "Pacific/Auckland",
      "Antarctica/Troll",
      "Etc/GMT+8",
      "Etc/UTC",
      "UTC",
      "GMT",
    ]) {
      expect(isValidTimezone(zone), `应为合法时区：${zone}`).toBe(true);
    }
  });

  it("常用时区清单（COMMON_TIMEZONES）全部通过服务端校验", () => {
    // 前端提供的快捷清单必须与服务端裁决一致，否则用户选中后会被 400 拒绝。
    expect(COMMON_TIMEZONES.length).toBeGreaterThanOrEqual(30);
    for (const zone of COMMON_TIMEZONES) {
      expect(isValidTimezone(zone), `常用清单含服务端拒绝的标识：${zone}`).toBe(true);
    }
  });

  it("运行时完整 IANA 列表（Intl.supportedValuesOf）全部通过服务端校验", () => {
    const zones = supportedTimezones();
    expect(zones.length).toBeGreaterThan(COMMON_TIMEZONES.length);
    for (const zone of zones) {
      expect(isValidTimezone(zone), `ICU 列表项被服务端拒绝：${zone}`).toBe(true);
    }
  });

  it("拒绝非 IANA 标识（虚构/裸偏移文本/多余层级/协议注入）", () => {
    for (const bad of [
      "Mars/Olympus",
      "Asia/Shanghai/Extra",
      "GMT+08:00",
      "UTC+8",
      "Asia/Nowhere",
      "Shanghai",
      "<script>alert(1)</script>",
      "__proto__",
      "constructor",
    ]) {
      expect(isValidTimezone(bad), `应拒绝：${bad}`).toBe(false);
    }
  });

  it("拒绝空串与纯空白；首尾空白被 trim 后仍按标识本身判定", () => {
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("   ")).toBe(false);
    expect(isValidTimezone("\t\n")).toBe(false);
    // ICU 不接受带空白的标识；trim 是服务端的归一化步骤（写库前也存 trim 后的值）。
    expect(isValidTimezone("  Asia/Shanghai  ")).toBe(true);
    expect(isValidTimezone(" Asia/Nowhere ")).toBe(false);
  });

  it("非字符串输入不会抛错，一律返回 false（防御性运行时校验）", () => {
    // 契约 schema 已拦住类型错误，此处只保证纯函数自身不炸。
    expect(isValidTimezone(42 as unknown as string)).toBe(false);
    expect(isValidTimezone(null as unknown as string)).toBe(false);
    expect(isValidTimezone(undefined as unknown as string)).toBe(false);
    expect(isValidTimezone({} as unknown as string)).toBe(false);
  });

  it("ICU 大小写不敏感：小写标识同样被接受（记录该行为，非严格 IANA 大小写）", () => {
    expect(isValidTimezone("asia/shanghai")).toBe(true);
    expect(isValidTimezone("utc")).toBe(true);
  });

  it("非法时区的字段级文案面向用户可读，且指明 IANA 要求", () => {
    expect(TIMEZONE_INVALID_MESSAGE).toContain("IANA");
    expect(TIMEZONE_INVALID_MESSAGE).toContain("Asia/Shanghai");
    expect(TIMEZONE_INVALID_MESSAGE.length).toBeLessThanOrEqual(500); // ErrorDetail.message 上限
  });
});

/* ── 2. 客户端预校验与偏移计算 ─────────────────────────────────────────── */

describe("isKnownTimezone（客户端预校验，与服务端语义一致）", () => {
  it("与服务端在同一批输入上给出相同结论", () => {
    const samples = [
      "Asia/Shanghai",
      "Asia/Tokyo",
      "Mars/Olympus",
      "",
      "   ",
      "GMT+08:00",
      "Europe/Berlin",
      "  Asia/Shanghai  ",
    ];
    for (const sample of samples) {
      expect(isKnownTimezone(sample), `客户端/服务端结论不一致：${sample}`).toBe(
        isValidTimezone(sample),
      );
    }
  });
});

describe("zoneOffsetMinutes（含夏令时）", () => {
  it("固定偏移时区：上海 +480、加尔各答 +330、加德满都 +345", () => {
    expect(zoneOffsetMinutes("Asia/Shanghai", WINTER)).toBe(480);
    expect(zoneOffsetMinutes("Asia/Kolkata", WINTER)).toBe(330);
    expect(zoneOffsetMinutes("Asia/Kathmandu", WINTER)).toBe(345);
    expect(zoneOffsetMinutes("UTC", WINTER)).toBe(0);
  });

  it("夏令时时区随时刻改变偏移：纽约冬季 -300、夏季 -240", () => {
    expect(zoneOffsetMinutes("America/New_York", WINTER)).toBe(-300);
    expect(zoneOffsetMinutes("America/New_York", SUMMER)).toBe(-240);
  });

  it("无法识别的时区返回 null（不抛错、不静默回退 0）", () => {
    expect(zoneOffsetMinutes("Mars/Olympus", WINTER)).toBeNull();
    expect(zoneOffsetMinutes("", WINTER)).toBeNull();
  });
});

describe("zoneOffsetLabel / zoneClock / zoneDateLabel / zoneDayProgress", () => {
  it("偏移标签形如 GMT+08:00（longOffset）；非法时区回退空串", () => {
    expect(zoneOffsetLabel("Asia/Shanghai", WINTER)).toBe("GMT+08:00");
    expect(zoneOffsetLabel("America/New_York", WINTER)).toBe("GMT-05:00");
    // ICU 78 的 longOffset 对零偏移也给出完整形式（旧版本为裸 "GMT"）——固定当前行为。
    expect(zoneOffsetLabel("UTC", WINTER)).toBe("GMT+00:00");
    expect(zoneOffsetLabel("Mars/Olympus", WINTER)).toBe("");
  });

  it("24 小时制时钟（hourCycle h23）不出现 24:xx 或上午/下午字样", () => {
    // 04:05:06Z → 上海 12:05:06
    expect(zoneClock("Asia/Shanghai", new Date("2026-01-15T04:05:06.000Z"))).toBe("12:05:06");
    // 午夜必须是 00:00:00（h24 会错误显示 24:00:00）
    expect(zoneClock("UTC", new Date("2026-01-15T00:00:00.000Z"))).toBe("00:00:00");
    expect(zoneClock("Mars/Olympus", WINTER)).toBe("--:--:--");
  });

  it("日期标签含年月日与星期（中文 locale）", () => {
    // 2026-09-09T04:00Z → 上海同日 12:00，星期三
    const label = zoneDateLabel("Asia/Shanghai", new Date("2026-09-09T04:00:00.000Z"));
    expect(label).toContain("2026");
    expect(label).toContain("9月9日");
    expect(label).toContain("周三");
    expect(zoneDateLabel("Mars/Olympus", WINTER)).toBe("");
  });

  it("一天进度按当地墙上时间计算：正午 0.5、午夜 0、跨日边界归属正确", () => {
    expect(zoneDayProgress("UTC", NOON_UTC)).toBe(0.5);
    expect(zoneDayProgress("UTC", new Date("2026-01-15T00:00:00.000Z"))).toBe(0);
    // 12:00Z 在上海是 20:00 → 20/24
    expect(zoneDayProgress("Asia/Shanghai", NOON_UTC)).toBeCloseTo(20 / 24, 10);
    expect(zoneDayProgress("Mars/Olympus", NOON_UTC)).toBe(0);
    const progress = zoneDayProgress("Asia/Tokyo", NOON_UTC);
    expect(progress).toBeGreaterThanOrEqual(0);
    expect(progress).toBeLessThanOrEqual(1);
  });
});

describe("describeZoneDifference（相对设备时区的时钟差文案）", () => {
  it("相同时区 → 「与设备时区相同」", () => {
    expect(describeZoneDifference("Asia/Shanghai", "Asia/Shanghai", WINTER)).toBe(
      "与设备时区相同",
    );
  });

  it("整小时差 → 「比设备时区快/慢 N 小时」", () => {
    expect(describeZoneDifference("Asia/Tokyo", "Asia/Shanghai", WINTER)).toBe(
      "比设备时区快 1 小时",
    );
    expect(describeZoneDifference("Europe/Berlin", "Asia/Shanghai", WINTER)).toBe(
      "比设备时区慢 7 小时",
    );
  });

  it("半小时/45 分钟时区保留小数（不四舍五入成整小时）", () => {
    expect(describeZoneDifference("Asia/Kathmandu", "Asia/Shanghai", WINTER)).toBe(
      "比设备时区慢 2.25 小时",
    );
    expect(describeZoneDifference("Asia/Kolkata", "Asia/Shanghai", WINTER)).toBe(
      "比设备时区慢 2.5 小时",
    );
  });

  it("夏令时期间差值随时刻变化（东京 vs 柏林：冬 8 小时、夏 7 小时）", () => {
    expect(describeZoneDifference("Europe/Berlin", "Asia/Tokyo", WINTER)).toBe(
      "比设备时区慢 8 小时",
    );
    expect(describeZoneDifference("Europe/Berlin", "Asia/Tokyo", SUMMER)).toBe(
      "比设备时区慢 7 小时",
    );
  });

  it("任一侧无法识别 → 「无法比较」（不猜测、不返回 NaN 文案）", () => {
    expect(describeZoneDifference("Mars/Olympus", "Asia/Shanghai", WINTER)).toBe("无法比较");
    expect(describeZoneDifference("Asia/Shanghai", "Mars/Olympus", WINTER)).toBe("无法比较");
  });
});

/* ── 3. 选项构造与过滤（组合框数据源） ─────────────────────────────────── */

describe("toTimezoneOption / buildTimezoneOptions", () => {
  it("常用时区带中文短标签与 common=true，其余用 IANA 标识本身", () => {
    const shanghai = toTimezoneOption("Asia/Shanghai", WINTER);
    expect(shanghai).toEqual({
      id: "Asia/Shanghai",
      label: "北京 · 上海",
      common: true,
      offsetLabel: "GMT+08:00",
      haystack: "北京 · 上海 asia/shanghai",
    });

    const obscure = toTimezoneOption("Antarctica/Troll", WINTER);
    expect(obscure.common).toBe(false);
    expect(obscure.label).toBe("Antarctica/Troll");
    expect(obscure.haystack).toBe("antarctica/troll antarctica/troll");
  });

  it("列表覆盖运行时全部 IANA 时区，常用项排在最前且保持清单原序", () => {
    const options = buildTimezoneOptions("Asia/Shanghai", WINTER);
    expect(options.length).toBeGreaterThanOrEqual(supportedTimezones().length);

    const commonIds = options.filter((o) => o.common).map((o) => o.id);
    // 常用块整体前置，且顺序与 COMMON_TIMEZONES 完全一致（上海居首）
    expect(options.slice(0, commonIds.length).every((o) => o.common)).toBe(true);
    expect(commonIds).toEqual([...COMMON_TIMEZONES]);
    expect(commonIds[0]).toBe("Asia/Shanghai");

    // 非常用块按字典序
    const rest = options.slice(commonIds.length).map((o) => o.id);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));

    // id 唯一（重复会让 React key 冲突、aria-activedescendant 指向歧义）
    expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
  });

  it("当前值即使不在运行时列表内也会被补入（历史标识不显示空白）", () => {
    const options = buildTimezoneOptions("Antarctica/Troll", WINTER);
    expect(options.some((o) => o.id === "Antarctica/Troll")).toBe(true);
  });

  it("当前值非法时不补入垃圾项（选择器回退显示原始字符串）", () => {
    const options = buildTimezoneOptions("Mars/Olympus", WINTER);
    expect(options.some((o) => o.id === "Mars/Olympus")).toBe(false);
    expect(options.length).toBeGreaterThanOrEqual(supportedTimezones().length);
  });
});

describe("filterTimezoneOptions（组合框搜索）", () => {
  const options = buildTimezoneOptions("Asia/Shanghai", WINTER);

  it("常用清单全部出现在选择器列表中（ICU 规范 ID 会漏掉 link 别名，必须补齐）", () => {
    // 回归护栏：Intl.supportedValuesOf("timeZone") 不含 UTC / Asia/Kolkata /
    // Asia/Kathmandu / Asia/Yangon / Asia/Ho_Chi_Minh / America/Argentina/Buenos_Aires，
    // 若不并入常用清单，用户搜不到自己所在的常用时区。
    const runtime = supportedTimezones();
    const missingAtRuntime = COMMON_TIMEZONES.filter((z) => !runtime.includes(z));
    expect(missingAtRuntime.length).toBeGreaterThan(0); // 前提成立，否则本用例无意义
    expect(missingAtRuntime.every((z) => isValidTimezone(z))).toBe(true); // 但都是合法标识

    const ids = new Set(options.map((o) => o.id));
    for (const zone of COMMON_TIMEZONES) {
      expect(ids.has(zone), `常用时区未出现在列表中：${zone}`).toBe(true);
    }
  });

  it("空查询返回前 limit 条（不复制全量，避免渲染数百行）", () => {
    expect(filterTimezoneOptions(options, "", 5)).toHaveLength(5);
    expect(filterTimezoneOptions(options, "   ", 5)).toHaveLength(5);
    expect(filterTimezoneOptions(options, "")).toHaveLength(Math.min(options.length, 80));
  });

  it("中文标签与 IANA 标识均可命中，大小写不敏感", () => {
    expect(filterTimezoneOptions(options, "上海", 80).some((o) => o.id === "Asia/Shanghai")).toBe(
      true,
    );
    expect(filterTimezoneOptions(options, "tokyo", 80).some((o) => o.id === "Asia/Tokyo")).toBe(
      true,
    );
    expect(filterTimezoneOptions(options, "ASIA/TOKYO", 80).some((o) => o.id === "Asia/Tokyo")).toBe(
      true,
    );
  });

  it("精确命中 IANA 标识的选项排最前（回车即选中意图项）", () => {
    // 用合成选项固定排序行为："utc" 同时命中两项，其中 id 恰为 "UTC" 的应排第一。
    const synthetic: TimezoneOption[] = [
      {
        id: "Etc/UTC",
        label: "Etc/UTC",
        common: false,
        offsetLabel: "GMT+00:00",
        haystack: "etc/utc etc/utc",
      },
      {
        id: "UTC",
        label: "协调世界时",
        common: true,
        offsetLabel: "GMT+00:00",
        haystack: "协调世界时 utc",
      },
    ];
    expect(filterTimezoneOptions(synthetic, "utc", 80).map((o) => o.id)).toEqual([
      "UTC",
      "Etc/UTC",
    ]);

    // 真实列表上同样成立：搜 "utc" 首项就是 UTC 本身。
    const matched = filterTimezoneOptions(options, "utc", 80);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched[0]?.id).toBe("UTC");
  });

  it("无匹配返回空数组（UI 据此显示空态提示）", () => {
    expect(filterTimezoneOptions(options, "zzz-not-a-zone", 80)).toEqual([]);
  });

  it("limit 生效：匹配数超过上限时截断", () => {
    expect(filterTimezoneOptions(options, "america", 3)).toHaveLength(3);
  });

  it("偏移标签可被搜索（GMT+08:00 不在 haystack 内 → 不命中，记录该边界）", () => {
    // haystack 只含 label + id：搜索偏移需用「+08」以外的关键词，此处固化当前行为。
    expect(filterTimezoneOptions(options, "GMT+08:00", 80)).toEqual([]);
  });
});

describe("deviceTimezone（设备时区快捷项）", () => {
  it("返回一个服务端也认可的 IANA 标识（回退值同样合法）", () => {
    const zone = deviceTimezone();
    expect(zone.length).toBeGreaterThan(0);
    expect(isValidTimezone(zone)).toBe(true);
  });
});
