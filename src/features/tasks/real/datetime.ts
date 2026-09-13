/**
 * 真实数据任务页的展示格式化纯工具（M2 Phase 6）。
 *
 * 无 React / 无服务端依赖，可进客户端 bundle，也可被单元测试直接引入。
 */

/**
 * ISO 日期时间 → 「2026年9月9日 14:03」（F23 修复：必须显式传**账户时区**，
 * 回收站删除时间等事件时间展示用；服务端组件从会话取时区后传入）。
 */
export function formatDateTimeCN(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
}
