// ⚠️ FIXTURE DATA — 非真实后端，仅供 M0 布局样例使用
import type {
  AttachmentDTO,
  CommentDTO,
  SubtaskDTO,
  TaskDTO,
} from "@/contracts";
import { BOARD_TASKS } from "@/features/board/fixtures";
import { PEOPLE } from "@/features/shell/fixtures";

/**
 * 任务详情 fixture（ORB-002）。
 *
 * ⚠️ 合成数据，非真实后端。TaskDTO 由看板 TaskSummary + description 派生，
 * 保证与看板卡片的 id 一致，从而 `?task=<id>` 侧面板能对上同一条任务。
 * 子任务/评论/附件覆盖多种状态（含删除占位、已编辑、上传中/失败）以演示详情区各态。
 */

/** 部分任务的描述正文（Markdown 纯文本；M0 不做富文本渲染，仅折行展示）。 */
const DESCRIPTIONS: Record<string, string> = {
  "CAMP-10": [
    "现有二维码在弱网下重复生成、且缺少幂等键，导致签到台出现重复记录。",
    "",
    "需要完成：",
    "1. 抽出 QR 生成服务，加入基于 (eventId, ticketId) 的幂等键；",
    "2. 生成失败时回退到 6 位数字签到码；",
    "3. 补充并发签到的集成测试。",
    "",
    "参考接口文档：https://docs.example.com/checkin/qr?id=orbit-camp-2026-spring",
  ].join("\n"),
  "CAMP-12":
    "报名表单需要在提交前校验：姓名必填、学号格式、同一活动不可重复报名。校验失败在字段旁提示，不打断已填写内容。",
  "CAMP-17":
    "调研教务处统一身份认证（CAS 3.0）：需登记回调白名单 https://orbit.example.com/api/auth/callback/cas?redirect=%2Fapp%2Ftoday ，" +
    "确认 /serviceValidate 的票据校验响应字段、失败回退到本地账号的边界，并整理对接人（信息中心 张老师 / 教务处 李老师）联系方式与工作时间。",
};

/** 全部任务详情（含描述），键为 task.id。 */
export const TASK_DETAILS: Record<string, TaskDTO> = Object.fromEntries(
  BOARD_TASKS.map(
    (t): [string, TaskDTO] => [
      t.id,
      { ...t, description: DESCRIPTIONS[t.identifier] ?? "" },
    ],
  ),
);

/** 按 id 查任务详情（页面/侧面板根据 ?task= 或路由参数解析）。 */
export function findTaskDetailById(id: string): TaskDTO | undefined {
  return TASK_DETAILS[id];
}

/** 演示用的主任务（CAMP-10），配套子任务/评论/附件。 */
const PRIMARY_SUMMARY = BOARD_TASKS.find((t) => t.identifier === "CAMP-10")!;
export const PRIMARY_TASK: TaskDTO = TASK_DETAILS[PRIMARY_SUMMARY.id]!;

const PRIMARY_TASK_ID = PRIMARY_TASK.id;

/** 子任务列表（含已完成与未完成）。 */
export const SUBTASKS: SubtaskDTO[] = [
  {
    id: "44444444-5555-4666-8777-888888880001",
    taskId: PRIMARY_TASK_ID,
    title: "抽出 QR 生成服务并定义接口",
    isCompleted: true,
    version: 2,
    createdAt: "2026-09-01T08:00:00Z",
    updatedAt: "2026-09-04T10:00:00Z",
  },
  {
    id: "44444444-5555-4666-8777-888888880002",
    taskId: PRIMARY_TASK_ID,
    title: "加入 (eventId, ticketId) 幂等键",
    isCompleted: true,
    version: 1,
    createdAt: "2026-09-01T08:05:00Z",
    updatedAt: "2026-09-05T09:00:00Z",
  },
  {
    id: "44444444-5555-4666-8777-888888880003",
    taskId: PRIMARY_TASK_ID,
    title: "生成失败回退到 6 位数字签到码",
    isCompleted: true,
    version: 1,
    createdAt: "2026-09-01T08:10:00Z",
    updatedAt: "2026-09-06T14:00:00Z",
  },
  {
    id: "44444444-5555-4666-8777-888888880004",
    taskId: PRIMARY_TASK_ID,
    title: "补充并发签到的集成测试（真 PostgreSQL）",
    isCompleted: false,
    version: 1,
    createdAt: "2026-09-02T08:00:00Z",
    updatedAt: "2026-09-02T08:00:00Z",
  },
  {
    id: "44444444-5555-4666-8777-888888880005",
    taskId: PRIMARY_TASK_ID,
    title: "更新签到台的运维手册与故障排查步骤",
    isCompleted: false,
    version: 1,
    createdAt: "2026-09-03T08:00:00Z",
    updatedAt: "2026-09-03T08:00:00Z",
  },
];

/** 评论区（含正常、已编辑、已删除占位三种）。 */
export const COMMENTS: CommentDTO[] = [
  {
    id: "55555555-6666-4777-8888-999999990001",
    taskId: PRIMARY_TASK_ID,
    author: PEOPLE.bao!,
    body: "幂等键方案我看了，建议把 ticketId 为空的情况也覆盖到，现场有无票补签的场景。",
    isDeleted: false,
    version: 1,
    editedAt: null,
    createdAt: "2026-09-05T02:30:00Z",
    updatedAt: "2026-09-05T02:30:00Z",
  },
  {
    id: "55555555-6666-4777-8888-999999990002",
    taskId: PRIMARY_TASK_ID,
    author: PEOPLE.alice!,
    body: "已补充无票补签分支，回退码改为 8 位以降低碰撞概率，稍后更新测试。",
    isDeleted: false,
    version: 2,
    editedAt: "2026-09-06T08:12:00Z",
    createdAt: "2026-09-06T08:00:00Z",
    updatedAt: "2026-09-06T08:12:00Z",
  },
  {
    id: "55555555-6666-4777-8888-999999990003",
    taskId: PRIMARY_TASK_ID,
    author: PEOPLE.chen!,
    body: null, // 已删除，保留占位
    isDeleted: true,
    version: 1,
    editedAt: null,
    createdAt: "2026-09-06T09:00:00Z",
    updatedAt: "2026-09-06T10:00:00Z",
  },
];

/** 附件列表（READY / UPLOADING / FAILED 三态）。 */
export const ATTACHMENTS: AttachmentDTO[] = [
  {
    id: "66666666-7777-4888-8999-aaaaaaaa0001",
    taskId: PRIMARY_TASK_ID,
    uploader: PEOPLE.alice!,
    uploadId: "99999999-8888-4777-8666-555555550001",
    fileName: "签到并发压测报告-2026-09.pdf",
    mimeType: "application/pdf",
    sizeBytes: 482_131,
    declaredSizeBytes: 482_131,
    state: "READY",
    errorCode: null,
    createdAt: "2026-09-06T11:00:00Z",
  },
  {
    id: "66666666-7777-4888-8999-aaaaaaaa0002",
    taskId: PRIMARY_TASK_ID,
    uploader: PEOPLE.bao!,
    uploadId: "99999999-8888-4777-8666-555555550002",
    fileName: "qr-fallback-flow.png",
    mimeType: "image/png",
    sizeBytes: null, // 上传中，尚无实际大小
    declaredSizeBytes: 1_048_576,
    state: "UPLOADING",
    errorCode: null,
    createdAt: "2026-09-07T03:20:00Z",
  },
  {
    id: "66666666-7777-4888-8999-aaaaaaaa0003",
    taskId: PRIMARY_TASK_ID,
    uploader: PEOPLE.chen!,
    uploadId: "99999999-8888-4777-8666-555555550003",
    fileName: "运维手册草稿.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: null,
    declaredSizeBytes: 20_971_520, // 声明 20MiB，超过 10MiB 上限
    state: "FAILED",
    errorCode: "FILE_TOO_LARGE",
    createdAt: "2026-09-07T05:00:00Z",
  },
];

