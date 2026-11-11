import type { TaskPriority, TaskStatus } from "@/contracts";

/**
 * 任务展示用的纯工具：状态和优先级的中文标签、看板列顺序、截止日相对「今天」的语义。
 * 日期都是用户时区下的 YYYY-MM-DD，比较用字典序。没有服务端依赖，也没有 React。
 */

export const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "待办",
  IN_PROGRESS: "进行中",
  DONE: "已完成",
};

/** 看板三列的固定顺序。 */
export const STATUS_COLUMN_ORDER: TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
  NONE: "无",
};

/** 截止日相对「今天」的语义。 */
export type DueTone = "overdue" | "today" | "soon" | "later" | "none";

export type DueMeta = {
  tone: DueTone;
  /** 卡片上的简短写法：今天、明天、昨天，或 9月12日。 */
  short: string;
  overdue: boolean;
  /** 给屏幕阅读器和悬停提示的完整说明。 */
  label: string;
};

/** 两个 YYYY-MM-DD 之间相差的整天数（to − from）。 */
function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function formatShort(date: string, today: string, diff: number): string {
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === -1) return "昨天";
  const [year, month, day] = date.split("-").map(Number);
  const text = `${month}月${day}日`;
  return date.slice(0, 4) === today.slice(0, 4) ? text : `${year}年${text}`;
}

/** 截止日相对「今天」的语义。已完成的任务不算逾期。 */
export function getDueMeta(dueDate: string | null, today: string, status: TaskStatus): DueMeta {
  if (!dueDate) return { tone: "none", short: "无截止", overdue: false, label: "无截止日" };
  const diff = dayDiff(today, dueDate);
  const short = formatShort(dueDate, today, diff);
  if (diff < 0 && status === "DONE") {
    return { tone: "later", short, overdue: false, label: `截止 ${dueDate}（已完成）` };
  }
  if (diff < 0) {
    return { tone: "overdue", short, overdue: true, label: `已逾期 ${-diff} 天（${dueDate}）` };
  }
  if (diff === 0) return { tone: "today", short, overdue: false, label: `今天截止（${dueDate}）` };
  if (diff <= 7) return { tone: "soon", short, overdue: false, label: `${diff} 天后截止（${dueDate}）` };
  return { tone: "later", short, overdue: false, label: `截止 ${dueDate}` };
}

/** 字节数格式化为可读大小（附件行用）。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
