import type { ProjectColor, TaskSummaryDTO } from "@/contracts";
import { BOARD_TASKS } from "./board-data";

/** 公开演示的合成数据：构建时写死，不读取任何真实项目。 */

export type DemoProject = { key: string; name: string; color: ProjectColor; members: number; count: number };

export const DEMO_PROJECTS: DemoProject[] = [
  { key: "CAMP", name: "校园活动报名系统", color: "BLUE", members: 4, count: 24 },
  { key: "PORT", name: "个人作品集", color: "PURPLE", members: 1, count: 12 },
  { key: "COURSE", name: "已结束课程设计（已归档）", color: "GRAY", members: 3, count: 8 },
];

const EXTRA_TITLES = [
  "梳理用户报名流程",
  "完善移动端布局",
  "验证重复报名提示",
  "整理测试记录",
  "准备演示素材",
  "检查键盘导航",
  "整理验收说明",
  "核对发布清单",
  "补充异常状态",
  "复核负责人分工",
  "整理项目回顾",
  "完成最终验收",
  "归档成果文档",
];

/** 某个演示项目的任务：先用看板样例，不够的按样例的属性循环补齐。 */
export function demoTasks(key: string): TaskSummaryDTO[] {
  const project = DEMO_PROJECTS.find((item) => item.key === key) ?? DEMO_PROJECTS[0]!;
  return Array.from({ length: project.count }, (_, index) => {
    const base = BOARD_TASKS[index % BOARD_TASKS.length]!;
    const original = key === "CAMP" && index < BOARD_TASKS.length;
    return {
      ...base,
      id: `demo-${key}-${index}`,
      identifier: `${key}-${index + 1}`,
      number: index + 1,
      title: original ? base.title : EXTRA_TITLES[index % EXTRA_TITLES.length]!,
      status: key === "COURSE" ? "DONE" : base.status,
    };
  });
}

export type DemoActivity = { who: string; action: string; ref?: string; when: string };

export function demoActivity(project: DemoProject): DemoActivity[] {
  return [
    { who: "陈墨", action: "发表了评论", ref: `${project.key}-6`, when: "10 分钟前" },
    { who: "林夏", action: "移动了任务", ref: `${project.key}-7`, when: "1 小时前" },
    { who: "苏晴", action: "上传了附件", ref: `${project.key}-5`, when: "3 小时前" },
    { who: "Dev Patel", action: "更新了子任务", ref: `${project.key}-1`, when: "昨天" },
    { who: "陈墨", action: "加入了项目", when: "3 天前" },
    { who: "林夏", action: `创建了项目「${project.name}」`, when: "2 周前" },
  ];
}

/** 任务详情里的样例子任务：数量与完成数取自任务摘要。 */
export const DEMO_SUBTASK_TITLES = ["确认需求和边界", "完成主要流程", "补充异常与空状态", "自测并记录结果", "请队友复核"];
