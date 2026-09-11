/**
 * 时区数据与格式化工具（M1 / ORB-006，个人设置页）。
 *
 * 边界（AGENTS.md、ESLint 规则）：本文件属 `src/features`，会进入浏览器 bundle，
 * 因此**不导入** `@/server`（server-only）与 `@/generated`。服务端已有
 * `src/server/me/timezone.ts` 的权威校验；此处的 `isKnownTimezone` 只是**客户端
 * 预校验**（提交前即时反馈），最终裁决仍在服务端 —— 二者语义一致但职责不同。
 *
 * 数据源：完整 IANA 列表用 `Intl.supportedValuesOf("timeZone")` 在运行时取
 * （浏览器/Node 的 ICU 数据可能不同，不做硬编码全量清单），并对老环境做守卫降级。
 */

/** 常用时区（约 30 个）：优先展示，覆盖目标用户（国内 + 常见协作地区）。 */
export const COMMON_TIMEZONES = [
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Singapore",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Manila",
  "Asia/Kolkata",
  "Asia/Karachi",
  "Asia/Dubai",
  "Asia/Almaty",
  "Asia/Irkutsk",
  "Asia/Vladivostok",
  "Asia/Kathmandu",
  "Asia/Yangon",
  "Asia/Ho_Chi_Minh",
  "Asia/Jerusalem",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Athens",
  "Europe/Helsinki",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "America/New_York",
  "America/Toronto",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "Pacific/Auckland",
  "Pacific/Fiji",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Perth",
  "UTC",
] as const;

/** 常用时区的中文短标签（只给常用表配标签，完整列表直接显示 IANA 标识）。 */
const COMMON_TIMEZONE_LABELS: Record<string, string> = {
  "Asia/Shanghai": "北京 · 上海",
  "Asia/Hong_Kong": "香港",
  "Asia/Taipei": "台北",
  "Asia/Tokyo": "东京",
  "Asia/Seoul": "首尔",
  "Asia/Singapore": "新加坡",
  "Asia/Bangkok": "曼谷",
  "Asia/Jakarta": "雅加达",
  "Asia/Manila": "马尼拉",
  "Asia/Kolkata": "印度（加尔各答）",
  "Asia/Karachi": "卡拉奇",
  "Asia/Dubai": "迪拜",
  "Asia/Almaty": "阿拉木图",
  "Asia/Irkutsk": "伊尔库茨克",
  "Asia/Vladivostok": "海参崴",
  "Asia/Kathmandu": "加德满都",
  "Asia/Yangon": "仰光",
  "Asia/Ho_Chi_Minh": "胡志明市",
  "Asia/Jerusalem": "耶路撒冷",
  "Europe/Istanbul": "伊斯坦布尔",
  "Europe/Moscow": "莫斯科",
  "Europe/Berlin": "柏林",
  "Europe/Paris": "巴黎",
  "Europe/Madrid": "马德里",
  "Europe/London": "伦敦",
  "Europe/Lisbon": "里斯本",
  "Europe/Athens": "雅典",
  "Europe/Helsinki": "赫尔辛基",
  "Africa/Cairo": "开罗",
  "Africa/Johannesburg": "约翰内斯堡",
  "America/New_York": "纽约",
  "America/Toronto": "多伦多",
  "America/Chicago": "芝加哥",
  "America/Denver": "丹佛",
  "America/Los_Angeles": "洛杉矶",
  "America/Vancouver": "温哥华",
  "America/Mexico_City": "墨西哥城",
  "America/Sao_Paulo": "圣保罗",
  "America/Argentina/Buenos_Aires": "布宜诺斯艾利斯",
  "Pacific/Auckland": "奥克兰",
  "Pacific/Fiji": "斐济",
  "Australia/Sydney": "悉尼",
  "Australia/Melbourne": "墨尔本",
  "Australia/Perth": "珀斯",
  UTC: "协调世界时",
};

/** 时区选项：下拉/组合框展示所需的全部字段（一次算好，避免渲染期重复构造 Intl）。 */
export type TimezoneOption = {
  /** IANA 标识（提交值）。 */
  id: string;
  /** 展示名：常用表用中文短标签，其余用 IANA 标识本身。 */
  label: string;
  /** 是否属常用时区（用于分组标题与排序）。 */
  common: boolean;
  /** GMT 偏移标签，如 "GMT+08:00"（按给定时刻计算，含夏令时）。 */
  offsetLabel: string;
  /** 搜索用的小写串（label + id）。 */
  haystack: string;
};

/** Intl.DateTimeFormat 构造成本高（完整时区列表约 400+ 项），按 key 缓存格式化器。 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${stableKey(options)}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("zh-CN", { timeZone, ...options });
  formatterCache.set(key, created);
  return created;
}

/** 把 options 序列化成稳定 key（只用到固定的几个字段，显式列举即可，无需通用序列化）。 */
function stableKey(options: Intl.DateTimeFormatOptions): string {
  const parts: string[] = [];
  if (options.hour !== undefined) parts.push(`h${options.hour}`);
  if (options.minute !== undefined) parts.push(`m${options.minute}`);
  if (options.second !== undefined) parts.push(`s${options.second}`);
  if (options.year !== undefined) parts.push(`y${options.year}`);
  if (options.month !== undefined) parts.push(`M${options.month}`);
  if (options.day !== undefined) parts.push(`d${options.day}`);
  if (options.weekday !== undefined) parts.push(`w${options.weekday}`);
  if (options.timeZoneName !== undefined) parts.push(`z${options.timeZoneName}`);
  if (options.hourCycle !== undefined) parts.push(`c${options.hourCycle}`);
  return parts.join(",");
}

/** 客户端预校验：该字符串能否被 ICU 识别为时区（非法时构造 DateTimeFormat 抛 RangeError）。 */
export function isKnownTimezone(timezone: string): boolean {
  const candidate = timezone.trim();
  if (candidate.length === 0) return false;
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

/**
 * 完整 IANA 时区列表（运行时取，已排序）。
 * 老环境无 `Intl.supportedValuesOf` 时降级为常用表（仍可用，只是不全）。
 */
export function supportedTimezones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;
  if (typeof supported !== "function") return [...COMMON_TIMEZONES];
  try {
    const zones = supported.call(Intl, "timeZone");
    return Array.isArray(zones) && zones.length > 0 ? [...zones].sort() : [...COMMON_TIMEZONES];
  } catch {
    return [...COMMON_TIMEZONES];
  }
}

/** GMT 偏移标签（longOffset → "GMT+08:00" / "GMT"）。无法识别的时区回退空串。 */
export function zoneOffsetLabel(timezone: string, at: Date = new Date()): string {
  if (!isKnownTimezone(timezone)) return "";
  const parts = getFormatter(timezone, { timeZoneName: "longOffset" }).formatToParts(at);
  for (const part of parts) {
    if (part.type === "timeZoneName") return part.value;
  }
  return "";
}

/** 该时区的 24 小时制时刻（"HH:MM:SS"）。 */
export function zoneClock(timezone: string, at: Date = new Date()): string {
  if (!isKnownTimezone(timezone)) return "--:--:--";
  return getFormatter(timezone, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

/** 该时区的日期 + 星期（"2026年9月9日 周三"）。 */
export function zoneDateLabel(timezone: string, at: Date = new Date()): string {
  if (!isKnownTimezone(timezone)) return "";
  return getFormatter(timezone, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(at);
}

/**
 * 该时区当天已过去的比例（0—1），用于 24 小时刻度尺上的游标位置。
 * 用当地 HH:MM:SS 换算，天然处理夏令时（偏移变化不影响「当地一天内的进度」）。
 */
export function zoneDayProgress(timezone: string, at: Date = new Date()): number {
  if (!isKnownTimezone(timezone)) return 0;
  const parts = getFormatter(timezone, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const read = (type: "hour" | "minute" | "second"): number => {
    for (const part of parts) {
      if (part.type === type) {
        const value = Number.parseInt(part.value, 10);
        return Number.isFinite(value) ? value : 0;
      }
    }
    return 0;
  };
  const seconds = read("hour") * 3600 + read("minute") * 60 + read("second");
  return Math.min(1, Math.max(0, seconds / 86400));
}

/** 构造单个时区选项。 */
export function toTimezoneOption(timezone: string, at: Date = new Date()): TimezoneOption {
  const common = (COMMON_TIMEZONES as readonly string[]).includes(timezone);
  const label = COMMON_TIMEZONE_LABELS[timezone] ?? timezone;
  return {
    id: timezone,
    label,
    common,
    offsetLabel: zoneOffsetLabel(timezone, at),
    haystack: `${label} ${timezone}`.toLowerCase(),
  };
}

/**
 * 全部可选时区（常用优先，其余按 IANA 字典序）。
 *
 * 列表 = 运行时 IANA 列表 ∪ 常用清单 ∪ 当前值，三者去重：
 *  - **必须并入常用清单**：`Intl.supportedValuesOf("timeZone")` 只返回 ICU 的
 *    **规范（canonical）** ID，不含 IANA link 别名。实测 Node 26 / ICU 78 下会漏掉
 *    `UTC`、`Asia/Kolkata`（规范名 Asia/Calcutta）、`Asia/Kathmandu`、`Asia/Yangon`、
 *    `Asia/Ho_Chi_Minh`、`America/Argentina/Buenos_Aires` —— 而这些恰恰是用户最常用、
 *    也是官方推荐的现代写法，且 `Intl.DateTimeFormat` 与服务端 `isValidTimezone` 都接受。
 *    不补齐就会出现「常用时区在列表里找不到」的缺陷。
 *  - **必须并入当前值**：账户可能存有任何 ICU 接受的标识（含历史别名），
 *    缺失会让选择器显示空白、用户无法确认当前设置。
 */
export function buildTimezoneOptions(current: string, at: Date = new Date()): TimezoneOption[] {
  const zones = supportedTimezones();
  const seen = new Set(zones);
  for (const zone of COMMON_TIMEZONES) {
    if (seen.has(zone)) continue;
    zones.push(zone);
    seen.add(zone);
  }
  if (isKnownTimezone(current) && !seen.has(current)) {
    zones.push(current);
    seen.add(current);
  }

  const options = zones.map((zone) => toTimezoneOption(zone, at));
  options.sort((a, b) => {
    if (a.common !== b.common) return a.common ? -1 : 1;
    if (a.common && b.common) {
      return (
        (COMMON_TIMEZONES as readonly string[]).indexOf(a.id) -
        (COMMON_TIMEZONES as readonly string[]).indexOf(b.id)
      );
    }
    return a.id.localeCompare(b.id);
  });
  return options;
}

/** 按关键词过滤（匹配中文标签或 IANA 标识，大小写不敏感），上限 limit 条。 */
export function filterTimezoneOptions(
  options: readonly TimezoneOption[],
  query: string,
  limit = 80,
): TimezoneOption[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return options.slice(0, limit);
  const matched: TimezoneOption[] = [];
  for (const option of options) {
    if (option.haystack.includes(needle)) {
      matched.push(option);
      if (matched.length >= limit) break;
    }
  }
  // 精确命中 IANA 标识的排最前，便于键盘直接回车选中。
  matched.sort((a, b) => Number(b.id.toLowerCase() === needle) - Number(a.id.toLowerCase() === needle));
  return matched;
}

/**
 * 该时区相对 UTC 的偏移分钟数（含夏令时）；无法识别时返回 null。
 *
 * 实现：把同一瞬间在该时区的「墙上时间」各字段当作 UTC 重新组装，
 * 与原瞬间之差即偏移量 —— 标准做法，无需解析偏移标签文本。
 */
export function zoneOffsetMinutes(timezone: string, at: Date = new Date()): number | null {
  if (!isKnownTimezone(timezone)) return null;
  const parts = getFormatter(timezone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const read = (type: string): number => {
    for (const part of parts) {
      if (part.type === type) {
        const value = Number.parseInt(part.value, 10);
        return Number.isFinite(value) ? value : 0;
      }
    }
    return 0;
  };
  const wallClockAsUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  const actualUtc = Math.floor(at.getTime() / 1000) * 1000;
  return Math.round((wallClockAsUtc - actualUtc) / 60000);
}

/**
 * 两个时区的时钟差文案（用于「与设备时区相差」提示）。
 * 半小时/45 分钟时区（Asia/Kolkata +5:30、Asia/Kathmandu +5:45）保留小数。
 */
export function describeZoneDifference(
  timezone: string,
  reference: string,
  at: Date = new Date(),
): string {
  const target = zoneOffsetMinutes(timezone, at);
  const base = zoneOffsetMinutes(reference, at);
  if (target === null || base === null) return "无法比较";
  const hours = (target - base) / 60;
  if (hours === 0) return "与设备时区相同";
  const sign = hours > 0 ? "快" : "慢";
  const magnitude = Math.abs(hours);
  const text = Number.isInteger(magnitude)
    ? `${magnitude}`
    : magnitude.toFixed(2).replace(/0$/, "");
  return `比设备时区${sign} ${text} 小时`;
}

/** 浏览器当前时区（用于「使用设备时区」快捷操作；不可识别时回退 Asia/Shanghai，同 docs/01 §3）。 */
export function deviceTimezone(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isKnownTimezone(resolved) ? resolved : "Asia/Shanghai";
  } catch {
    return "Asia/Shanghai";
  }
}
