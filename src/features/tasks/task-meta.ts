import type { TaskPriority, TaskStatus } from "@/contracts";

/**
 * 任务展示元信息与格式化纯工具（ORB-002）。
 *
 * 供 today / board / tasks 三处复用：状态与优先级的中文标签、看板列顺序、
 * 截止日相对「今天」的语义（逾期/今天/临近）、日期与字节格式化。
 * 纯函数、无服务端依赖、无 React。日期比较用 YYYY-MM-DD 字典序（等价于时间序）。
 */

export const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "待办",
  IN_PROGRESS: "进行中",
  DONE: "已完成",
};

/** 看板三列固定顺序（docs/02 §5）。 */
export const STATUS_COLUMN_ORDER: TaskStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "DONE",
];

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
  NONE: "无",
};

/** 截止日语义（相对参照「今天」）。 */
export type DueTone = "overdue" | "today" | "soon" | "later" | "none";

export type DueMeta = {
  tone: DueTone;
  /** 简短展示，如 09/12；无截止日为「无截止」。 */
  short: string;
  overdue: boolean;
  /** 面向屏幕阅读器/tooltip 的完整说明。 */
  label: string;
};

/** 把 YYYY-MM-DD 格式化为 MM/DD。 */
export function formatDueShort(isoDate: string): string {
  const [, mm, dd] = isoDate.split("-");
  return `${mm}/${dd}`;
}

const WEEKDAY_CN = [
  "星期日",
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
];

/** 把 YYYY-MM-DD 格式化为「2026年9月8日 · 星期二」（工作台日期行）。 */
export function formatDateCN(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const weekday = WEEKDAY_CN[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${year}年${month}月${day}日 · ${weekday ?? ""}`;
}

/** 两个 YYYY-MM-DD 之间相差的整天数（b - a）。 */
function dayDiff(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * 计算截止日相对「今天」的语义。
 * 已完成任务不计逾期（DONE 时 overdue=false）。
 */
export function getDueMeta(
  dueDate: string | null,
  today: string,
  status: TaskStatus,
): DueMeta {
  if (!dueDate) {
    return { tone: "none", short: "无截止", overdue: false, label: "无截止日" };
  }
  const diff = dayDiff(today, dueDate);
  const short = formatDueShort(dueDate);
  if (diff < 0 && status === "DONE") {
    return { tone: "later", short, overdue: false, label: `截止 ${dueDate}（已完成）` };
  }
  if (diff < 0 && status !== "DONE") {
    const days = Math.abs(diff);
    return {
      tone: "overdue",
      short,
      overdue: true,
      label: `已逾期 ${days} 天（${dueDate}）`,
    };
  }
  if (diff === 0) {
    return { tone: "today", short, overdue: false, label: `今天截止（${dueDate}）` };
  }
  if (diff <= 7) {
    return {
      tone: "soon",
      short,
      overdue: false,
      label: `${diff} 天后截止（${dueDate}）`,
    };
  }
  return { tone: "later", short, overdue: false, label: `截止 ${dueDate}` };
}

/** 任务是否逾期（有截止日、未完成、早于今天）。 */
export function isOverdue(
  dueDate: string | null,
  today: string,
  status: TaskStatus,
): boolean {
  return getDueMeta(dueDate, today, status).overdue;
}

/** 字节数格式化为可读大小（附件行用）。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}
