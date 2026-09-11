import "server-only";

/**
 * IANA 时区校验（M1 / ORB-006）。
 *
 * 产品规则（docs/01 §3）：用户可修改姓名与 IANA 时区，**服务端验证时区**；
 * 数据不变量（docs/04 §3）：User.timezone 存 IANA 标识，默认 Asia/Shanghai。
 *
 * 校验方式：交给 ICU（`Intl.DateTimeFormat`）判定——它是运行时权威时区数据库，
 * 比手写正则/静态清单更准确且随平台更新。非法标识会抛 RangeError，据此返回 false。
 *
 * 错误语义（AGENTS.md「不新增错误码」）：非法时区复用契约既有 `VALIDATION_ERROR`(400)，
 * 并以 `fieldErrors.timezone` 定位到字段，不引入新 code。
 */

/** 非法时区的字段级提示（进入 fieldErrors.timezone，面向用户可读）。 */
export const TIMEZONE_INVALID_MESSAGE = "时区无效，须为 IANA 标识（例如 Asia/Shanghai）。";

/**
 * 裸偏移格式（如 `+08:00` / `-0500`）：Intl 会把它当作合法时区解析，但这不是
 * IANA 区域标识（不含地区、无夏令时规则），业务上必须拒绝，避免脏数据入库。
 */
const BARE_OFFSET_PATTERN = /^[+-]\d{2}:?\d{2}$/;

/**
 * 归一化并校验 IANA 时区标识；非法时返回 null。
 *
 * 相比旧的「构造成功即合法」判定，这里进一步用 `resolvedOptions().timeZone` 取 ICU 的
 * 解析结果，从而：
 *  - 拒绝裸偏移（`+08:00`、`-0500`）——Intl 会接受它们，但它们不是 IANA 区域标识；
 *  - 修正大小写（`asia/shanghai` → `Asia/Shanghai`），入库值统一。
 *
 * ⚠️ 关于「存哪个值」：部分 ICU 版本的 `resolvedOptions().timeZone` 会把现代规范名
 * 降级为历史别名（如 `Asia/Kolkata` → `Asia/Calcutta`、`Asia/Kathmandu` → `Asia/Katmandu`）。
 * 直接回存 resolved 会把这些**本已规范**的输入降级，反而弄脏数据。因此规则为：
 *  - 当输入与 resolved **仅大小写不同**（忽略大小写相等）时，采用 resolved 修正大小写；
 *  - 否则（输入已是合法标识，resolved 只是其别名/历史拼写）保留 trim 后的原始输入，避免降级。
 *
 * 纯函数、无副作用、不访问数据库。解析失败或规范形式为空一律返回 null。
 */
export function normalizeTimezone(timezone: string): string | null {
  if (typeof timezone !== "string") return null;
  const candidate = timezone.trim();
  if (candidate.length === 0) return null;
  // 先拒裸偏移：Intl 会把 `+08:00` 解析为合法时区，但它不是 IANA 区域标识。
  if (BARE_OFFSET_PATTERN.test(candidate)) return null;
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: candidate })
      .resolvedOptions().timeZone;
    if (!resolved) return null;
    // 仅大小写不同 → 用 resolved 修正大小写（asia/shanghai → Asia/Shanghai）；
    // 否则输入已是合法标识（resolved 可能为历史别名）→ 保留输入，避免降级。
    if (candidate.toLowerCase() === resolved.toLowerCase()) return resolved;
    return candidate;
  } catch {
    return null;
  }
}

/**
 * 判断字符串是否为运行时可识别的 IANA 时区标识。
 *
 * 纯函数、无副作用、不访问数据库。空串/含控制字符/非 IANA 别名/裸偏移一律 false。
 * 语义与 `normalizeTimezone` 保持一致（能被归一化即视为合法）。
 */
export function isValidTimezone(timezone: string): boolean {
  return normalizeTimezone(timezone) !== null;
}
