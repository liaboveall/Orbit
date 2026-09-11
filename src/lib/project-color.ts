import type { ProjectColor } from "@/contracts";

/**
 * 项目标记色映射（ORB-002）。
 *
 * docs/02 §2：项目颜色为 6 个固定 token（蓝/紫/青/绿/橙/灰），仅用于项目标记，
 * 不替代状态或权限标识。这里把契约枚举 ProjectColor 映射到 tokens.css 中的
 * `--color-project-*` 工具类与中文标签，供侧栏、项目页头、任务卡等复用。
 * 纯映射、无服务端依赖。
 */

export const PROJECT_COLOR_DOT: Record<ProjectColor, string> = {
  BLUE: "bg-project-blue",
  PURPLE: "bg-project-purple",
  TEAL: "bg-project-teal",
  GREEN: "bg-project-green",
  ORANGE: "bg-project-orange",
  GRAY: "bg-project-gray",
};

export const PROJECT_COLOR_LABEL: Record<ProjectColor, string> = {
  BLUE: "蓝",
  PURPLE: "紫",
  TEAL: "青",
  GREEN: "绿",
  ORANGE: "橙",
  GRAY: "灰",
};

/** 项目标记圆点（含可访问的颜色文本，避免仅靠颜色传达信息）。 */
export function projectColorAria(color: ProjectColor): string {
  return `项目标记色：${PROJECT_COLOR_LABEL[color]}`;
}
