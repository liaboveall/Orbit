import type { TaskSummaryDTO, UserSummaryDTO } from "@/contracts";

export const DEMO_DATE = "2026-09-08";

const PEOPLE = {
  alice: { id: "u_alice", name: "林晓" },
  bao: { id: "u_bao", name: "包峥" },
  chen: { id: "u_chen", name: "陈静" },
  dev: { id: "u_dev", name: "Dev Patel" },
} satisfies Record<string, UserSummaryDTO>;

let seq = 0;

function task(input: {
  number: number;
  title: string;
  status: TaskSummaryDTO["status"];
  priority: TaskSummaryDTO["priority"];
  dueDate: string | null;
  assignee?: UserSummaryDTO | null;
  subtaskTotal?: number;
  subtaskCompleted?: number;
  commentCount?: number;
  attachmentCount?: number;
  completedAt?: string | null;
}): TaskSummaryDTO {
  seq += 1;
  return {
    id: `33333333-4444-4555-8666-77777777${String(seq).padStart(4, "0")}`,
    projectId: "11111111-2222-4333-8444-555555555501",
    number: input.number,
    identifier: `CAMP-${input.number}`,
    title: input.title,
    status: input.status,
    priority: input.priority,
    assignee: input.assignee ?? null,
    creator: PEOPLE.alice,
    dueDate: input.dueDate,
    completedAt: input.completedAt ?? null,
    version: 1,
    subtaskTotal: input.subtaskTotal ?? 0,
    subtaskCompleted: input.subtaskCompleted ?? 0,
    commentCount: input.commentCount ?? 0,
    attachmentCount: input.attachmentCount ?? 0,
    deletedAt: null,
    createdAt: "2026-08-26T08:00:00Z",
    updatedAt: "2026-09-07T12:00:00Z",
  };
}

/** 看板全部任务（未筛选）。页面按 status 分列。 */
export const BOARD_TASKS: TaskSummaryDTO[] = [
  // ── 待办 TODO ──
  task({
    number: 12,
    title: "完成活动详情页的报名表单校验",
    status: "TODO",
    priority: "HIGH",
    dueDate: "2026-09-05", // 逾期
    assignee: PEOPLE.alice,
    subtaskTotal: 4,
    subtaskCompleted: 2,
  }),
  task({
    number: 14,
    title: "设计志愿者排班表的数据结构",
    status: "TODO",
    priority: "MEDIUM",
    dueDate: "2026-09-12",
    assignee: PEOPLE.bao,
    commentCount: 2,
  }),
  task({
    number: 15,
    title: "补充多校区签到点的网络异常降级说明",
    status: "TODO",
    priority: "LOW",
    dueDate: null,
    assignee: PEOPLE.chen,
  }),
  task({
    number: 16,
    title: "为报名成功页添加日历订阅（.ics）导出",
    status: "TODO",
    priority: "NONE",
    dueDate: "2026-09-15",
  }),
  task({
    number: 17,
    title:
      "调研并在文档中记录教务处统一身份认证（CAS 3.0）对接所需的回调白名单、票据校验流程与失败回退策略，附对接人联系方式",
    status: "TODO",
    priority: "MEDIUM",
    dueDate: "2026-09-14",
    assignee: PEOPLE.dev,
    attachmentCount: 1,
  }),
  // ── 进行中 IN_PROGRESS ──
  task({
    number: 8,
    title: "接入报名接口与名额扣减事务",
    status: "IN_PROGRESS",
    priority: "MEDIUM",
    dueDate: "2026-09-10",
    assignee: PEOPLE.bao,
    commentCount: 3,
  }),
  task({
    number: 10,
    title: "重构签到二维码生成模块",
    status: "IN_PROGRESS",
    priority: "HIGH",
    dueDate: "2026-09-07", // 逾期
    assignee: PEOPLE.alice,
    subtaskTotal: 5,
    subtaskCompleted: 3,
    commentCount: 5,
    attachmentCount: 2,
  }),
  task({
    number: 11,
    title: "撰写活动页无障碍自查清单",
    status: "IN_PROGRESS",
    priority: "LOW",
    dueDate: null,
    assignee: PEOPLE.chen,
  }),
  // ── 已完成 DONE ──
  task({
    number: 2,
    title: "明确数据结构与 ER 图",
    status: "DONE",
    priority: "MEDIUM",
    dueDate: "2026-09-07",
    assignee: PEOPLE.dev,
    completedAt: "2026-09-06T11:20:00Z",
  }),
  task({
    number: 4,
    title: "搭建 Next.js 16 与 Prisma 7 脚手架",
    status: "DONE",
    priority: "HIGH",
    dueDate: "2026-09-03",
    assignee: PEOPLE.alice,
    completedAt: "2026-09-03T08:00:00Z",
    commentCount: 1,
  }),
  task({
    number: 6,
    title: "定义 API 契约与错误码",
    status: "DONE",
    priority: "NONE",
    dueDate: null,
    assignee: PEOPLE.bao,
    completedAt: "2026-09-05T09:30:00Z",
  }),
];

/** 筛选无结果态：空数组（页面显示「没有匹配任务」+ 清除筛选）。 */
