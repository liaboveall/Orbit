import { describe, expect, it } from "vitest";
import {
  AttachmentSchema,
  ActivitySchema,
  BoardSchema,
  CommentSchema,
  CreateProjectSchema,
  CreateTaskSchema,
  MoveTaskSchema,
  OverviewSchema,
  ProjectSchema,
  TaskSchema,
  TaskSummarySchema,
  UpdateMeSchema,
  UpdateProjectSchema,
  UpdateTaskSchema,
  UserSchema,
  UserSummarySchema,
} from "@/contracts";

/**
 * 核心 DTO schema 正反例测试（ORB-003）。
 * 严格对齐 contracts/openapi.json components/schemas 的真实字段与约束。
 */

const UUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const DT = "2026-09-08T10:00:00.000Z";
const DATE = "2026-10-12";

const VALID_USER_SUMMARY = { id: "user_1", name: "张三" };

const VALID_PROJECT = {
  id: UUID,
  name: "Orbit 演示项目",
  key: "ORB",
  description: "",
  color: "BLUE",
  ownerId: "user_1",
  role: "OWNER",
  archivedAt: null,
  version: 1,
  boardVersion: 1,
  memberCount: 1,
  openTaskCount: 0,
  createdAt: DT,
  updatedAt: DT,
};

const VALID_TASK_SUMMARY = {
  id: UUID,
  projectId: UUID,
  number: 1,
  identifier: "ORB-1",
  title: "完成活动详情页",
  status: "TODO",
  priority: "HIGH",
  assignee: VALID_USER_SUMMARY,
  creator: VALID_USER_SUMMARY,
  dueDate: DATE,
  completedAt: null,
  version: 1,
  subtaskTotal: 0,
  subtaskCompleted: 0,
  commentCount: 0,
  attachmentCount: 0,
  deletedAt: null,
  createdAt: DT,
  updatedAt: DT,
};

const VALID_TASK = { ...VALID_TASK_SUMMARY, description: "展示时间、地点与剩余名额。" };

describe("UserSchema / UserSummarySchema", () => {
  it("正例：完整用户档案解析成功", () => {
    const value = {
      id: "user_1",
      name: "张三",
      email: "zhangsan@example.com",
      emailVerified: true,
      timezone: "Asia/Shanghai",
    };
    expect(UserSchema.safeParse(value).success).toBe(true);
    expect(UserSummarySchema.safeParse(VALID_USER_SUMMARY).success).toBe(true);
  });

  it("反例：非法 email / name 超长 41 / 缺 timezone 失败", () => {
    const base = {
      id: "u",
      name: "n",
      email: "zhangsan@example.com",
      emailVerified: true,
      timezone: "Asia/Shanghai",
    };
    expect(UserSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
    expect(UserSchema.safeParse({ ...base, name: "a".repeat(41) }).success).toBe(false);
    const { timezone: _tz, ...noTz } = base;
    expect(UserSchema.safeParse(noTz).success).toBe(false);
  });

  it("反例：strict 拒绝未知字段（如 password）", () => {
    expect(
      UserSummarySchema.safeParse({ ...VALID_USER_SUMMARY, password: "x" }).success,
    ).toBe(false);
  });
});

describe("ProjectSchema", () => {
  it("正例：完整项目解析成功", () => {
    expect(ProjectSchema.safeParse(VALID_PROJECT).success).toBe(true);
  });

  it("反例：非法 color / role 失败", () => {
    expect(ProjectSchema.safeParse({ ...VALID_PROJECT, color: "RED" }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...VALID_PROJECT, role: "ADMIN" }).success).toBe(false);
  });

  it("反例：key 不符合 ^[A-Z][A-Z0-9]{1,7}$（过短/小写/非法首字符）", () => {
    expect(ProjectSchema.safeParse({ ...VALID_PROJECT, key: "O" }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...VALID_PROJECT, key: "orb" }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...VALID_PROJECT, key: "1RB" }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...VALID_PROJECT, key: "ABCDEFGHI" }).success).toBe(false); // 9 位
  });

  it("边界/反例：memberCount 1–20、version≥1、description≤2000", () => {
    expect(ProjectSchema.safeParse({ ...VALID_PROJECT, memberCount: 20 }).success).toBe(true);
    expect(ProjectSchema.safeParse({ ...VALID_PROJECT, memberCount: 0 }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...VALID_PROJECT, memberCount: 21 }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...VALID_PROJECT, version: 0 }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...VALID_PROJECT, description: "a".repeat(2001) }).success).toBe(
      false,
    );
  });

  it("反例：strict 拒绝泄露字段（password / tokenHash / objectKey）", () => {
    expect(ProjectSchema.safeParse({ ...VALID_PROJECT, password: "x" }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...VALID_PROJECT, tokenHash: "x" }).success).toBe(false);
  });
});

describe("TaskSchema / TaskSummarySchema", () => {
  it("正例：Task 含 description，TaskSummary 不含", () => {
    expect(TaskSchema.safeParse(VALID_TASK).success).toBe(true);
    expect(TaskSummarySchema.safeParse(VALID_TASK_SUMMARY).success).toBe(true);
  });

  it("反例：TaskSummary 出现 description 被 strict 拒绝（列表不含大段描述）", () => {
    expect(TaskSummarySchema.safeParse(VALID_TASK).success).toBe(false);
  });

  it("反例：Task 缺 description（required）失败", () => {
    expect(TaskSchema.safeParse(VALID_TASK_SUMMARY).success).toBe(false);
  });

  it("反例：非法 status / priority 失败", () => {
    expect(TaskSchema.safeParse({ ...VALID_TASK, status: "DOING" }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...VALID_TASK, priority: "URGENT" }).success).toBe(false);
  });

  it("边界/反例：title 1–120、number≥1、version≥1", () => {
    expect(TaskSchema.safeParse({ ...VALID_TASK, title: "a".repeat(120) }).success).toBe(true);
    expect(TaskSchema.safeParse({ ...VALID_TASK, title: "a".repeat(121) }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...VALID_TASK, title: "" }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...VALID_TASK, number: 0 }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...VALID_TASK, version: 0 }).success).toBe(false);
  });

  it("边界：dueDate 可为 null 或 YYYY-MM-DD；非法日期字符串失败", () => {
    expect(TaskSchema.safeParse({ ...VALID_TASK, dueDate: null }).success).toBe(true);
    expect(TaskSchema.safeParse({ ...VALID_TASK, dueDate: DATE }).success).toBe(true);
    expect(TaskSchema.safeParse({ ...VALID_TASK, dueDate: "10/12/2026" }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...VALID_TASK, dueDate: DT }).success).toBe(false); // date-only 不接受 datetime
  });

  it("边界：assignee 可为 null；completedAt 可为 datetime 或 null", () => {
    expect(TaskSchema.safeParse({ ...VALID_TASK, assignee: null }).success).toBe(true);
    expect(TaskSchema.safeParse({ ...VALID_TASK, completedAt: DT }).success).toBe(true);
  });

  it("反例：id 必须是 UUID", () => {
    expect(TaskSchema.safeParse({ ...VALID_TASK, id: "not-a-uuid" }).success).toBe(false);
  });
});

describe("请求 DTO：Create/Update/Move", () => {
  it("CreateProject：required name+key，color/description 可选", () => {
    expect(CreateProjectSchema.safeParse({ name: "p", key: "ORB" }).success).toBe(true);
    expect(CreateProjectSchema.safeParse({ name: "p" }).success).toBe(false);
    expect(CreateProjectSchema.safeParse({ name: "p", key: "ORB", color: "TEAL" }).success).toBe(true);
    expect(CreateProjectSchema.safeParse({ name: "p", key: "ORB", ownerId: "x" }).success).toBe(false);
  });

  it("CreateTask：required title；priority/status/assigneeId/dueDate 可选", () => {
    expect(CreateTaskSchema.safeParse({ title: "t" }).success).toBe(true);
    expect(
      CreateTaskSchema.safeParse({ title: "t", priority: "LOW", assigneeId: null, dueDate: DATE })
        .success,
    ).toBe(true);
    expect(CreateTaskSchema.safeParse({}).success).toBe(false);
  });

  it("UpdateProject：expectedVersion 必填 + minProperties:2（至少一个可改字段）", () => {
    expect(UpdateProjectSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(UpdateProjectSchema.safeParse({ expectedVersion: 1, name: "n" }).success).toBe(true);
    expect(UpdateProjectSchema.safeParse({ name: "n" }).success).toBe(false);
  });

  it("UpdateTask：expectedVersion 必填 + minProperties:2", () => {
    expect(UpdateTaskSchema.safeParse({ expectedVersion: 3 }).success).toBe(false);
    expect(UpdateTaskSchema.safeParse({ expectedVersion: 3, dueDate: null }).success).toBe(true);
    expect(UpdateTaskSchema.safeParse({ expectedVersion: 0, title: "x" }).success).toBe(false);
  });

  it("MoveTask：beforeTaskId 可为 null；缺 toStatus 失败", () => {
    expect(
      MoveTaskSchema.safeParse({
        expectedVersion: 4,
        expectedBoardVersion: 12,
        toStatus: "IN_PROGRESS",
        beforeTaskId: null,
      }).success,
    ).toBe(true);
    expect(
      MoveTaskSchema.safeParse({ expectedVersion: 4, expectedBoardVersion: 12, beforeTaskId: null })
        .success,
    ).toBe(false);
  });
});

/**
 * UpdateMe（PATCH /me，ORB-006）：白名单只有 name / timezone。
 * 对齐 openapi.json components/schemas/UpdateMe（additionalProperties:false、minProperties:1）。
 */
describe("UpdateMeSchema", () => {
  it("正例：单独改 name、单独改 timezone、同时改两者均通过", () => {
    expect(UpdateMeSchema.safeParse({ name: "李四" }).success).toBe(true);
    expect(UpdateMeSchema.safeParse({ timezone: "Asia/Tokyo" }).success).toBe(true);
    expect(
      UpdateMeSchema.safeParse({ name: "李四", timezone: "Europe/Berlin" }).success,
    ).toBe(true);
  });

  it("minProperties:1 —— 空对象失败，且 issue 落在根路径", () => {
    const result = UpdateMeSchema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    // 根级 refine → path 为空 → HTTP 层 fieldErrors 键为 "(root)"（无字段可指）。
    expect(result.error.issues[0]?.path).toEqual([]);
    expect(result.error.issues[0]?.message).toContain("至少提供一个可修改字段");
  });

  it("additionalProperties:false —— 拒绝未知字段与越权写入（email/id/emailVerified）", () => {
    expect(UpdateMeSchema.safeParse({ name: "李四", nickname: "小四" }).success).toBe(false);
    // 关键安全边界：不得经 /me 改邮箱、提权或改他人记录。
    expect(
      UpdateMeSchema.safeParse({ name: "李四", email: "hacker@orbit.test" }).success,
    ).toBe(false);
    expect(UpdateMeSchema.safeParse({ emailVerified: true }).success).toBe(false);
    expect(UpdateMeSchema.safeParse({ id: "user_2" }).success).toBe(false);

    // 固化 HTTP 层映射：Zod 4 把 unrecognized_keys 的 issue 放在根路径并带上多余键名，
    // 因此 fieldErrors 键为 "(root)"，message 仍会指名是哪个字段被拒。
    const result = UpdateMeSchema.safeParse({ name: "李四", email: "hacker@orbit.test" });
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue?.code).toBe("unrecognized_keys");
      expect(issue?.path).toEqual([]);
      expect(issue?.message).toContain("email");
    }
  });

  it("name 约束 1—40；timezone 约束 1—100（形状层不判定 IANA 合法性）", () => {
    expect(UpdateMeSchema.safeParse({ name: "" }).success).toBe(false);
    expect(UpdateMeSchema.safeParse({ name: "a".repeat(41) }).success).toBe(false);
    expect(UpdateMeSchema.safeParse({ name: "a".repeat(40) }).success).toBe(true);
    expect(UpdateMeSchema.safeParse({ timezone: "" }).success).toBe(false);
    expect(UpdateMeSchema.safeParse({ timezone: "x".repeat(101) }).success).toBe(false);
    // IANA 合法性由服务端 src/server/me/timezone.ts 判定（ICU 权威），契约只管形状。
    expect(UpdateMeSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(true);
  });

  it("类型错误：name/timezone 必须为字符串", () => {
    expect(UpdateMeSchema.safeParse({ name: 42 }).success).toBe(false);
    expect(UpdateMeSchema.safeParse({ timezone: null }).success).toBe(false);
    expect(UpdateMeSchema.safeParse({ name: ["李四"] }).success).toBe(false);
  });
});

describe("子资源 DTO：Comment / Attachment / Activity / Board / Overview", () => {
  it("Comment：body 可为 null（已删除），非法超长失败", () => {
    const base = {
      id: UUID,
      taskId: UUID,
      author: VALID_USER_SUMMARY,
      body: "正文",
      isDeleted: false,
      version: 1,
      editedAt: null,
      createdAt: DT,
      updatedAt: DT,
    };
    expect(CommentSchema.safeParse(base).success).toBe(true);
    expect(CommentSchema.safeParse({ ...base, body: null, isDeleted: true }).success).toBe(true);
    expect(CommentSchema.safeParse({ ...base, body: "a".repeat(2001) }).success).toBe(false);
  });

  it("Attachment：sizeBytes 可空、declaredSizeBytes ≤10MiB、state 枚举", () => {
    const base = {
      id: UUID,
      taskId: UUID,
      uploader: VALID_USER_SUMMARY,
      uploadId: UUID,
      fileName: "a.png",
      mimeType: "image/png",
      sizeBytes: null,
      declaredSizeBytes: 1024,
      state: "UPLOADING",
      errorCode: null,
      createdAt: DT,
    };
    expect(AttachmentSchema.safeParse(base).success).toBe(true);
    expect(AttachmentSchema.safeParse({ ...base, declaredSizeBytes: 10_485_761 }).success).toBe(false);
    expect(AttachmentSchema.safeParse({ ...base, state: "DELETED" }).success).toBe(false);
    // 不泄露 objectKey。
    expect(AttachmentSchema.safeParse({ ...base, objectKey: "secret/key" }).success).toBe(false);
  });

  it("Activity：action 必须属于 docs/05 §9 全集", () => {
    const base = {
      id: UUID,
      projectId: UUID,
      actor: VALID_USER_SUMMARY,
      entityType: "TASK",
      entityId: UUID,
      action: "TASK_CREATED",
      metadata: {},
      createdAt: DT,
    };
    expect(ActivitySchema.safeParse(base).success).toBe(true);
    expect(ActivitySchema.safeParse({ ...base, action: "INVITATION_CREATED" }).success).toBe(false);
    expect(ActivitySchema.safeParse({ ...base, entityType: "INVITE" }).success).toBe(false);
  });

  it("Board：boardVersion + columns[]（含 TaskSummary items）", () => {
    const column = { status: "TODO", total: 1, items: [VALID_TASK_SUMMARY], nextCursor: null };
    const board = { boardVersion: 13, columns: [column] };
    expect(BoardSchema.safeParse(board).success).toBe(true);
    expect(BoardSchema.safeParse({ boardVersion: 0, columns: [] }).success).toBe(false);
    // items 内出现 description 应被 TaskSummary strict 拒绝。
    expect(
      BoardSchema.safeParse({
        boardVersion: 1,
        columns: [{ ...column, items: [VALID_TASK] }],
      }).success,
    ).toBe(false);
  });

  it("Overview：today 为 date-only，计数 ≥0", () => {
    const base = {
      timezone: "Asia/Shanghai",
      today: DATE,
      overdue: 0,
      dueToday: 1,
      upcoming: 2,
      inProgress: 3,
      totalOpen: 4,
    };
    expect(OverviewSchema.safeParse(base).success).toBe(true);
    expect(OverviewSchema.safeParse({ ...base, today: DT }).success).toBe(false);
    expect(OverviewSchema.safeParse({ ...base, overdue: -1 }).success).toBe(false);
  });
});

describe("DTO 白名单：不泄露敏感字段", () => {
  const FORBIDDEN = [
    "password",
    "passwordHash",
    "session",
    "sessionToken",
    "token",
    "tokenHash",
    "objectKey",
    "stack",
    "email", // UserSummary/Member 不应含 email（docs/05 §4）
  ];

  const shapes: Record<string, Record<string, unknown>> = {
    UserSummary: UserSummarySchema.shape,
    Project: ProjectSchema.shape,
    Task: TaskSchema.shape,
    TaskSummary: TaskSummarySchema.shape,
    Comment: CommentSchema.shape,
    Attachment: AttachmentSchema.shape,
  };

  it("核心 DTO 字段名不含任何敏感/越权字段", () => {
    for (const [name, shape] of Object.entries(shapes)) {
      for (const key of Object.keys(shape)) {
        expect(FORBIDDEN, `${name}.${key}`).not.toContain(key);
      }
    }
  });

  it("Member 不披露 email（仅 userId/name/role/joinedAt）", () => {
    // UserSchema 允许 email（本人档案），但 UserSummary/Project/Task 不得含 email。
    expect(Object.keys(UserSummarySchema.shape)).not.toContain("email");
    expect(Object.keys(ProjectSchema.shape)).not.toContain("email");
  });
});

