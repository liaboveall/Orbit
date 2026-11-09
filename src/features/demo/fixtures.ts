import type { TaskSummaryDTO } from "@/contracts";
import { BOARD_TASKS } from "./board-data";
export const DEMO_PROJECTS = [
  { key: "CAMP", name: "校园活动报名系统", count: 24 },
  { key: "PORT", name: "个人作品集", count: 12 },
  { key: "COURSE", name: "已结束课程设计（已归档）", count: 8 },
] as const;
const extraTitles = ["梳理用户报名流程", "完善移动端布局", "验证重复报名提示", "整理测试记录", "准备演示素材", "检查键盘导航", "整理验收说明", "核对发布清单", "补充异常状态", "复核负责人分工", "整理项目回顾", "完成最终验收", "归档成果文档"];
export function demoTasks(key: string): TaskSummaryDTO[] {
  const project = DEMO_PROJECTS.find(p => p.key === key) ?? DEMO_PROJECTS[0];
  return Array.from({ length: project.count }, (_, i) => {
    const base = BOARD_TASKS[i % BOARD_TASKS.length]!;
    return { ...base, id: `demo-${key}-${i}`, identifier: `${key}-${i + 1}`, number: i + 1,
      title: key === "CAMP" && i < BOARD_TASKS.length ? base.title : extraTitles[i % extraTitles.length]!,
      status: key === "COURSE" ? "DONE" : base.status };
  });
}
