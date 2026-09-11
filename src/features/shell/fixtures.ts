// ⚠️ FIXTURE DATA — 非真实后端，仅供 M0 布局样例使用
import type { ProjectDTO, UserDTO, UserSummaryDTO } from "@/contracts";

/**
 * AppShell 导航 fixture（ORB-002）。
 *
 * ⚠️ 本文件全部为合成数据，不来自数据库/后端，仅用于 M0 三页布局样例的渲染与六态演示。
 * 类型标注使用 src/contracts 的 DTO（UserDTO/ProjectDTO/UserSummaryDTO），
 * 字段严格对齐 schema（UUID、日期时间、name≤80、key ^[A-Z][A-Z0-9]{1,7}$ 等）。
 *
 * 这些「规范化实体」被 today/board/tasks 的 fixture 复用，避免同一份合成数据多处漂移。
 *
 * ORB-006 边界变更：AppShell / UserMenu **不再**引用 CURRENT_USER —— 外壳已接入真实
 * 会话用户（layout 用 getSessionUser 取得后经 props 下发）。CURRENT_USER 现仅供
 * today/board/task 样例页（工作台视角的「我」）使用，M2 接入真实业务数据后一并移除。
 */

/** 样例「我」（工作台视角）：仅 fixture 页面使用，不代表当前登录账户。 */
export const CURRENT_USER: UserDTO = {
  id: "u_alice",
  name: "林晓",
  email: "linxiao@example.com",
  emailVerified: true,
  timezone: "Asia/Shanghai",
};

/** 协作成员（内嵌精简用户，不含 email，docs/05 §4）。 */
export const PEOPLE: Record<string, UserSummaryDTO> = {
  alice: { id: "u_alice", name: "林晓" },
  bao: { id: "u_bao", name: "包峥" },
  chen: { id: "u_chen", name: "陈静" },
  dev: { id: "u_dev", name: "Dev Patel" },
};

/** 项目集合（≤6，供侧栏「最近项目」）。含一个超长名称用于截断 + tooltip 演示。 */
export const PROJECTS: ProjectDTO[] = [
  {
    id: "11111111-2222-4333-8444-555555555501",
    name: "校园活动报名系统",
    key: "CAMP",
    description: "面向院系活动的报名、签到与志愿者排班平台。",
    color: "BLUE",
    ownerId: "u_alice",
    role: "OWNER",
    archivedAt: null,
    version: 3,
    boardVersion: 7,
    memberCount: 4,
    openTaskCount: 16,
    createdAt: "2026-08-20T08:00:00Z",
    updatedAt: "2026-09-07T10:12:00Z",
  },
  {
    id: "11111111-2222-4333-8444-555555555502",
    name: "毕业设计进度追踪",
    key: "THES",
    description: "记录开题、中期、答辩各阶段材料与导师反馈。",
    color: "PURPLE",
    ownerId: "u_alice",
    role: "OWNER",
    archivedAt: null,
    version: 2,
    boardVersion: 4,
    memberCount: 1,
    openTaskCount: 6,
    createdAt: "2026-08-25T08:00:00Z",
    updatedAt: "2026-09-06T09:30:00Z",
  },
  {
    id: "11111111-2222-4333-8444-555555555503",
    name: "黑客松 · Orbit 参赛项目",
    key: "HACK",
    description: "48 小时黑客松的作品开发与演示准备。",
    color: "TEAL",
    ownerId: "u_bao",
    role: "MEMBER",
    archivedAt: null,
    version: 5,
    boardVersion: 12,
    memberCount: 4,
    openTaskCount: 9,
    createdAt: "2026-08-28T08:00:00Z",
    updatedAt: "2026-09-07T18:45:00Z",
  },
  {
    id: "11111111-2222-4333-8444-555555555504",
    name: "数据库课程设计",
    key: "DBCS",
    description: "小组课程设计：需求、ER 图、实现与报告。",
    color: "GREEN",
    ownerId: "u_chen",
    role: "MEMBER",
    archivedAt: null,
    version: 1,
    boardVersion: 2,
    memberCount: 3,
    openTaskCount: 4,
    createdAt: "2026-09-01T08:00:00Z",
    updatedAt: "2026-09-05T14:00:00Z",
  },
  {
    // 超长项目名：用于演示侧栏/页头截断 + tooltip，且不推挤主操作。
    id: "11111111-2222-4333-8444-555555555505",
    name: "2026春季学期校园文化活动统一报名与签到管理平台（含志愿者排班）",
    key: "LONG",
    description: "名称很长，用于验证截断与 tooltip 行为。",
    color: "ORANGE",
    ownerId: "u_alice",
    role: "OWNER",
    archivedAt: null,
    version: 1,
    boardVersion: 1,
    memberCount: 2,
    openTaskCount: 1,
    createdAt: "2026-09-02T08:00:00Z",
    updatedAt: "2026-09-02T08:00:00Z",
  },
  {
    id: "11111111-2222-4333-8444-555555555506",
    name: "读书会共读计划",
    key: "READ",
    description: "每周一本书的共读与笔记归档。",
    color: "GRAY",
    ownerId: "u_dev",
    role: "MEMBER",
    archivedAt: null,
    version: 2,
    boardVersion: 3,
    memberCount: 5,
    openTaskCount: 2,
    createdAt: "2026-09-03T08:00:00Z",
    updatedAt: "2026-09-04T20:00:00Z",
  },
];

/** 侧栏最近项目（最多 6 个，docs/02 §4）。 */
export const SIDEBAR_PROJECTS: ProjectDTO[] = PROJECTS.slice(0, 6);

/** 样例参照「今天」（date-only），用于稳定演示逾期/今天/未来 7 天。 */
export const SAMPLE_TODAY = "2026-09-08";

/** 看板样例默认使用的项目（CAMP）。 */
export const BOARD_PROJECT: ProjectDTO = PROJECTS[0]!;

/** 按 id 查项目（页面根据路由参数解析项目/颜色/名称）。 */
export function findProjectById(id: string): ProjectDTO | undefined {
  return PROJECTS.find((p) => p.id === id);
}
