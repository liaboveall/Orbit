// ⚠️ FIXTURE DATA — 非真实后端，仅供 M0 布局样例使用
import type {
  OverviewDTO,
  TaskSummaryDTO,
  UserSummaryDTO,
} from "@/contracts";
import { CURRENT_USER, PEOPLE, PROJECTS } from "@/features/shell/fixtures";

/**
 * 我的工作台 fixture（ORB-002）。
 *
 * ⚠️ 合成数据，非真实后端。类型标注使用 src/contracts 的 OverviewDTO / TaskSummaryDTO。
 * 参照日期取「今天 = 2026-09-08（周二，Asia/Shanghai）」以稳定演示逾期/今天/未来 7 天。
 * 数据集合非互斥（同一任务可同时属于「进行中」和「今天」），故工作台不显示合计饼图。
 */

const CAMP = PROJECTS[0]!.id;
const THES = PROJECTS[1]!.id;
const HACK = PROJECTS[2]!.id;

let seq = 0;

/** 本地工厂：以少量必填项生成一条完整、类型安全的 TaskSummaryDTO。 */
function task(input: {
  projectId: string;
  number: number;
  identifier: string;
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
  const id = `22222222-3333-4333-8444-66666666${String(seq).padStart(4, "0")}`;
  return {
    id,
    projectId: input.projectId,
    number: input.number,
    identifier: input.identifier,
    title: input.title,
    status: input.status,
    priority: input.priority,
    assignee: input.assignee ?? CURRENT_USER,
    creator: PEOPLE.alice!,
    dueDate: input.dueDate,
    completedAt: input.completedAt ?? null,
    version: 1,
    subtaskTotal: input.subtaskTotal ?? 0,
    subtaskCompleted: input.subtaskCompleted ?? 0,
    commentCount: input.commentCount ?? 0,
    attachmentCount: input.attachmentCount ?? 0,
    deletedAt: null,
    createdAt: "2026-09-01T08:00:00Z",
    updatedAt: "2026-09-07T09:00:00Z",
  };
}

/** GET /me/overview 的计数概览（today 为 date-only）。 */
export const TODAY_OVERVIEW: OverviewDTO = {
  timezone: CURRENT_USER.timezone,
  today: "2026-09-08",
  overdue: 2,
  dueToday: 3,
  upcoming: 4,
  inProgress: 3,
  totalOpen: 8,
};

/** 正常数据态：分配给我的任务（跨项目、多优先级、多截止分布）。 */
export const TODAY_TASKS: TaskSummaryDTO[] = [
  // 逾期
  task({
    projectId: CAMP,
    number: 12,
    identifier: "CAMP-12",
    title: "完成活动详情页的报名表单校验",
    status: "IN_PROGRESS",
    priority: "HIGH",
    dueDate: "2026-09-05",
    subtaskTotal: 4,
    subtaskCompleted: 2,
    commentCount: 3,
  }),
  task({
    projectId: THES,
    number: 3,
    identifier: "THES-3",
    title: "整理开题报告参考文献格式",
    status: "TODO",
    priority: "MEDIUM",
    dueDate: "2026-09-06",
  }),
  // 今天
  task({
    projectId: CAMP,
    number: 18,
    identifier: "CAMP-18",
    title: "对接报名成功后的邮件通知文案",
    status: "TODO",
    priority: "HIGH",
    dueDate: "2026-09-08",
    commentCount: 1,
  }),
  task({
    projectId: HACK,
    number: 5,
    identifier: "HACK-5",
    title: "准备路演 PPT 前三页",
    status: "IN_PROGRESS",
    priority: "MEDIUM",
    dueDate: "2026-09-08",
    attachmentCount: 1,
  }),
  task({
    projectId: THES,
    number: 4,
    identifier: "THES-4",
    title: "把实验数据画成折线图",
    status: "TODO",
    priority: "LOW",
    dueDate: "2026-09-08",
  }),
  // 未来 7 天
  task({
    projectId: CAMP,
    number: 21,
    identifier: "CAMP-21",
    title: "编写志愿者排班的冲突检测逻辑",
    status: "TODO",
    priority: "MEDIUM",
    dueDate: "2026-09-11",
    subtaskTotal: 3,
    subtaskCompleted: 0,
  }),
  task({
    projectId: HACK,
    number: 7,
    identifier: "HACK-7",
    title: "录制 90 秒产品演示视频",
    status: "TODO",
    priority: "HIGH",
    dueDate: "2026-09-13",
  }),
  // 进行中（无截止）
  task({
    projectId: CAMP,
    number: 9,
    identifier: "CAMP-9",
    title: "重构签到二维码生成模块",
    status: "IN_PROGRESS",
    priority: "NONE",
    dueDate: null,
    commentCount: 5,
    attachmentCount: 2,
  }),
];

/** 空态 A：首次无任务。 */
export const TODAY_TASKS_EMPTY: TaskSummaryDTO[] = [];

/** 空态 B：今天安排的都已完成（全部 DONE）。 */
export const TODAY_TASKS_ALL_DONE: TaskSummaryDTO[] = [
  task({
    projectId: CAMP,
    number: 30,
    identifier: "CAMP-30",
    title: "核对本周报名名单",
    status: "DONE",
    priority: "MEDIUM",
    dueDate: "2026-09-08",
    completedAt: "2026-09-08T07:40:00Z",
  }),
];

/** long-content 态：长中文 / 长英文 / 长 URL 的折行演示。 */
export const TODAY_TASKS_LONG: TaskSummaryDTO[] = [
  task({
    projectId: PROJECTS[4]!.id,
    number: 42,
    identifier: "LONG-42",
    title:
      "协调并确认二〇二六春季学期校园文化活动统一报名平台在多校区、多时段、多角色（学生／教师／校外嘉宾／志愿者）并发场景下的签到限流与降级策略，并同步给教务处与信息中心的对接人",
    status: "IN_PROGRESS",
    priority: "HIGH",
    dueDate: "2026-09-10",
  }),
  task({
    projectId: HACK,
    number: 43,
    identifier: "HACK-43",
    title:
      "Investigate why the OAuth2 redirect occasionally drops the state parameter on Safari 26 when returning from https://accounts.example.co.uk/oauth2/authorize?client_id=orbit&response_type=code&scope=openid%20profile%20email",
    status: "TODO",
    priority: "MEDIUM",
    dueDate: "2026-09-09",
  }),
];
