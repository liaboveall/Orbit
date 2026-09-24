import "server-only";

/**
 * 不可见 / 方向控制字符判定（F09；用户姓名与附件文件名共用同一口径）。
 *
 *  - U+202A–U+202E（bidi 嵌入/覆盖）与 U+2066–U+2069（bidi 隔离）会把显示顺序伪装成
 *    与逻辑顺序相反（Trojan Source 类视觉欺骗），例如让 `photo‮gnp.txt` 在列表中
 *    显示成以 png 结尾；
 *  - C0 控制字符（保留 \t \n \r 以外）、DEL 与 C1 控制字符没有展示价值，且部分终端/日志会误渲染。
 *
 * 正常中文、组合字符（NFD 分解）、emoji 与其他国际化内容全部保留。
 */
export const BIDI_CONTROL_CHARACTERS = /[‪-‮⁦-⁩]/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

/** 是否包含方向控制字符或非空白控制字符。 */
export function hasUnsafeDisplayCharacters(value: string): boolean {
  return BIDI_CONTROL_CHARACTERS.test(value) || CONTROL_CHARACTERS.test(value);
}
