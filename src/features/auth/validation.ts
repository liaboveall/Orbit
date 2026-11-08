/**
 * 认证表单客户端校验（M1 / ORB-005，纯函数）。
 *
 * 与服务端约束保持一致（options.ts：密码 12–128；requireEmailVerification）。
 * 客户端即时反馈用于体验，**不替代**服务端校验（服务端仍是权威）。
 */

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** 姓名长度上限（与服务端 /api/v1/me 及 UserSchema 的 name ≤ 40 约束保持一致）。 */
export const NAME_MIN = 1;
export const NAME_MAX = 40;

/** 简单邮箱格式校验（与服务端 z.email 意图一致；权威校验在服务端）。 */
export function isValidEmail(value: string): boolean {
  // 允许常见本地部分与域名；不做过度严格的 RFC 校验，服务端兜底。
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/** 密码长度是否满足 12–128。 */
export function isValidPasswordLength(value: string): boolean {
  return value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
}

/** 姓名去除首尾空白后长度须在 1—40 之间（与服务端权威约束一致）。 */
export function isValidName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= NAME_MIN && trimmed.length <= NAME_MAX;
}

export type PasswordStrength = {
  /** 0–4，用于强度条分段。 */
  score: number;
  label: string;
  /** 语义色 token 类名（text-*）。 */
  tone: "text-foreground-muted" | "text-danger" | "text-warning" | "text-success";
};

/**
 * 密码强度评估（长度为主，辅以字符种类）。仅用于即时提示，不做安全承诺。
 * 长度不足 12 时最高只给「太短」，因为服务端会直接拒绝。
 */
export function assessPasswordStrength(value: string): PasswordStrength {
  if (value.length === 0) {
    return { score: 0, label: `至少 ${PASSWORD_MIN} 个字符`, tone: "text-foreground-muted" };
  }
  if (value.length < PASSWORD_MIN) {
    return {
      score: 1,
      label: `还需 ${PASSWORD_MIN - value.length} 个字符（最少 ${PASSWORD_MIN}）`,
      tone: "text-danger",
    };
  }
  if (value.length > PASSWORD_MAX) {
    return {
      score: 1,
      label: `不超过 ${PASSWORD_MAX} 个字符`,
      tone: "text-danger",
    };
  }
  let variety = 0;
  if (/[a-z]/.test(value)) variety += 1;
  if (/[A-Z]/.test(value)) variety += 1;
  if (/\d/.test(value)) variety += 1;
  if (/[^A-Za-z0-9]/.test(value)) variety += 1;

  const long = value.length >= 16;
  if (variety >= 3 && long) return { score: 4, label: "很强", tone: "text-success" };
  if (variety >= 3) return { score: 3, label: "强", tone: "text-success" };
  if (variety === 2) return { score: 2, label: "中等 · 建议混合大小写/数字/符号", tone: "text-warning" };
  return { score: 2, label: `满足最少 ${PASSWORD_MIN} 位 · 建议增加字符种类`, tone: "text-warning" };
}
