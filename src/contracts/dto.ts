import { z } from "zod";
import {
  ActivityActionSchema,
  ActivityEntityTypeSchema,
  ActivityMetadataFieldSchema,
  AttachmentStateSchema,
  InvitationStateSchema,
  InvitePreviewRoleSchema,
  ListVisibilityFilterSchema,
  ProjectColorSchema,
  ProjectListScopeSchema,
  ProjectRoleSchema,
  TaskPrioritySchema,
  TaskSortSchema,
  TaskStatusSchema,
} from "./enums";
import {
  CursorSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  NullableIsoDateTimeSchema,
  UserIdSchema,
  UuidSchema,
  VersionSchema,
  DueDateSchema,
} from "./primitives";

/**
 * 核心 DTO schemas（ORB-003）。
 *
 * 严格对齐 contracts/openapi.json components/schemas：字段名、类型、约束、required、
 * additionalProperties:false（→ Zod `.strict()`）逐一映射，不臆造契约中不存在的字段。
 *
 * 安全（docs/05 §2、AGENTS.md）：DTO 只暴露白名单字段，绝不包含
 * password / session / tokenHash / objectKey / 内部堆栈。ProjectDTO.role 是计算字段。
 *
 * 命名约定：`XSchema`（运行时 Zod）+ `XDTO`（`z.infer` 类型）。
 * 本模块无服务端依赖，可进入客户端 bundle（前后端共享同一套校验）。
 */

/* ── 共享格式 ─────────────────────────────────────────────────────────── */

/** Project.key：`^[A-Z][A-Z0-9]{1,7}$`（2–8 位大写字母数字，首字符为字母）。 */
export const ProjectKeySchema = z.string().regex(/^[A-Z][A-Z0-9]{1,7}$/);

/** UploadAttachment.sha256：`^[a-f0-9]{64}$`（客户端声明的内容摘要，服务端会重算）。 */
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/** 附件大小上限：10 MiB（openapi maximum:10485760）。 */
const AttachmentSizeSchema = z.number().int().min(1).max(10_485_760);

/** 统计「显式出现且非 undefined」的字段数，用于 PATCH 的 minProperties 约束。 */
function countPresentFields(value: object): number {
  return Object.values(value).filter((v) => v !== undefined).length;
}

/* ── 用户 ─────────────────────────────────────────────────────────────── */

/** UserSummary：内嵌于 Task/Comment/Member 等的精简用户（不含 email，docs/05 §4）。 */
export const UserSummarySchema = z.strictObject({
  id: UserIdSchema,
  name: z.string().min(1).max(40),
});
export type UserSummaryDTO = z.infer<typeof UserSummarySchema>;

/** User：当前登录用户档案（GET /me）。含 email，仅本人可见。 */
export const UserSchema = z.strictObject({
  id: UserIdSchema,
  name: z.string().min(1).max(40),
  email: z.email(),
  emailVerified: z.boolean(),
  timezone: z.string().min(1).max(100),
});
export type UserDTO = z.infer<typeof UserSchema>;

/** UpdateMe：PATCH /me 请求体，minProperties:1（至少改一项）。 */
export const UpdateMeSchema = z
  .strictObject({
    name: z.string().min(1).max(40).optional(),
    timezone: z.string().min(1).max(100).optional(),
  })
  .refine((v) => countPresentFields(v) >= 1, {
    message: "至少提供一个可修改字段",
  });
export type UpdateMeDTO = z.infer<typeof UpdateMeSchema>;

/* ── 项目 ─────────────────────────────────────────────────────────────── */

/** Project：项目 DTO。role 为计算得到的 OWNER/MEMBER（不写库）。 */
export const ProjectSchema = z.strictObject({
  id: UuidSchema,
  name: z.string().min(1).max(80),
  key: ProjectKeySchema,
  description: z.string().min(0).max(2000),
  color: ProjectColorSchema,
  ownerId: UserIdSchema,
  role: ProjectRoleSchema,
  archivedAt: NullableIsoDateTimeSchema,
  version: VersionSchema,
  boardVersion: VersionSchema,
  memberCount: z.number().int().min(1).max(20),
  openTaskCount: z.number().int().min(0),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ProjectDTO = z.infer<typeof ProjectSchema>;

/** CreateProject：POST /projects 请求体，required:[name,key]。 */
export const CreateProjectSchema = z.strictObject({
  name: z.string().min(1).max(80),
  key: ProjectKeySchema,
  description: z.string().min(0).max(2000).optional(),
  color: ProjectColorSchema.optional(),
});
export type CreateProjectDTO = z.infer<typeof CreateProjectSchema>;

/** UpdateProject：PATCH /projects/{id}，expectedVersion 必填 + minProperties:2。 */
export const UpdateProjectSchema = z
  .strictObject({
    expectedVersion: VersionSchema,
    name: z.string().min(1).max(80).optional(),
    description: z.string().min(0).max(2000).optional(),
    color: ProjectColorSchema.optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => countPresentFields(v) >= 2, {
    message: "除 expectedVersion 外至少提供一个可修改字段",
  });
export type UpdateProjectDTO = z.infer<typeof UpdateProjectSchema>;

/** Member（ProjectMemberDTO）：userId/name/role/joinedAt，不向队友披露 email（docs/05 §4）。 */
export const MemberSchema = z.strictObject({
  userId: UserIdSchema,
  name: z.string().min(1).max(40),
  role: ProjectRoleSchema,
  joinedAt: IsoDateTimeSchema,
});
export type MemberDTO = z.infer<typeof MemberSchema>;

/* ── 邀请 ─────────────────────────────────────────────────────────────── */

/** Invitation：邀请元数据（永不含明文 token / tokenHash）。 */
export const InvitationSchema = z.strictObject({
  id: UuidSchema,
  projectId: UuidSchema,
  createdById: UserIdSchema,
  createdAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  revokedAt: NullableIsoDateTimeSchema,
  acceptedAt: NullableIsoDateTimeSchema,
  state: InvitationStateSchema,
});
export type InvitationDTO = z.infer<typeof InvitationSchema>;

/**
 * CreatedInvitation：创建邀请响应。token 仅首次返回（重放为 null，docs/05 §5），
 * 因此 token/invitePath 皆可空；token 明文不进入幂等记录。
 */
export const CreatedInvitationSchema = z.strictObject({
  invitation: InvitationSchema,
  token: z.string().min(40).max(128).nullable(),
  invitePath: z.string().min(1).max(300).nullable(),
});
export type CreatedInvitationDTO = z.infer<typeof CreatedInvitationSchema>;

/** InviteToken：接受邀请请求体（明文 token）。 */
export const InviteTokenSchema = z.strictObject({
  token: z.string().min(40).max(128),
});
export type InviteTokenDTO = z.infer<typeof InviteTokenSchema>;

/** InvitePreview：匿名邀请预览（只暴露必要信息，role 恒为 MEMBER）。 */
export const InvitePreviewSchema = z.strictObject({
  projectName: z.string().min(1).max(80),
  ownerName: z.string().min(1).max(40),
  expiresAt: IsoDateTimeSchema,
  role: InvitePreviewRoleSchema,
  isArchived: z.boolean(),
});
export type InvitePreviewDTO = z.infer<typeof InvitePreviewSchema>;

/** AcceptedInvitation：接受邀请结果。 */
export const AcceptedInvitationSchema = z.strictObject({
  projectId: UuidSchema,
  alreadyMember: z.boolean(),
  createdNewMembership: z.boolean().optional(),
});
export type AcceptedInvitationDTO = z.infer<typeof AcceptedInvitationSchema>;

/* ── 任务 ─────────────────────────────────────────────────────────────── */

/**
 * TaskSummary：列表用摘要，不含大段 description（详情才用 Task，docs/05 §6）。
 * 与 Task 字段一致但少了 description。
 */
export const TaskSummarySchema = z.strictObject({
  id: UuidSchema,
  projectId: UuidSchema,
  number: z.number().int().min(1),
  identifier: z.string().min(3).max(40),
  title: z.string().min(1).max(120),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  assignee: UserSummarySchema.nullable(),
  creator: UserSummarySchema,
  dueDate: IsoDateSchema.nullable(),
  completedAt: NullableIsoDateTimeSchema,
  version: VersionSchema,
  subtaskTotal: z.number().int().min(0),
  subtaskCompleted: z.number().int().min(0),
  commentCount: z.number().int().min(0),
  attachmentCount: z.number().int().min(0),
  deletedAt: NullableIsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type TaskSummaryDTO = z.infer<typeof TaskSummarySchema>;

/**
 * Task DTO - represents a task item in project tasks list
 * 
 * Fields:
 * - id: UUID primary key
 * - projectId: FK to Project.id (user must be member)
 * - number: Auto-increment task number within project (e.g., "PROJ-1")
 * - identifier: Combined key for reference ("${project.key}-${number}")
 * - title: Required, max 120 chars
 * - description: Optional text, no limit
 * - status: TODO | IN_PROGRESS | DONE
 * - priority: NONE | LOW | MEDIUM | HIGH
 * - dueDate: Nullable date string in YYYY-MM-DD format (validated range 1900-2100)
 * - creatorId: FK to User.id who created this task
 * - assigneeId: Nullable FK to User.id assigned to (can be null or different from creator)
 * - version: Optimistic concurrency control counter (starts at 1, increments on each update)
 * - deletedAt: Soft delete timestamp (null if active, non-null if in trash)
 * - createdAt: Creation timestamp (ISO 8601)
 * - updatedAt: Last modification timestamp (ISO 8601)
 * 
 * Validation Rules:
 * - Title cannot be empty after trim
 * - DueDate must be valid date string between 1900-01-01 and 2100-12-31
 * - Status enum values strictly enforced (TODO/IN_PROGRESS/DONE)
 * - Priority enum values strictly enforced (NONE/LOW/MEDIUM/HIGH)
 */
export const TaskSchema = TaskSummarySchema.extend({
  description: z.string().min(0).max(10000),
});
export type TaskDTO = z.infer<typeof TaskSchema>;

/** CreateTask: POST /projects/{id}/tasks，required:[title]。 */
export const CreateTaskSchema = z.strictObject({
  title: z.string().min(1).max(120),
  description: z.string().min(0).max(10000).optional(),
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  assigneeId: UserIdSchema.nullable().optional(),
  dueDate: DueDateSchema.nullable().optional(),
});
export type CreateTaskDTO = z.infer<typeof CreateTaskSchema>;

/** UpdateTask: PATCH /tasks/{id}，expectedVersion 必填 + minProperties:2。 */
export const UpdateTaskSchema = z
  .strictObject({
    expectedVersion: VersionSchema,
    title: z.string().min(1).max(120).optional(),
    description: z.string().min(0).max(10000).optional(),
    status: TaskStatusSchema.optional(),
    priority: TaskPrioritySchema.optional(),
    assigneeId: UserIdSchema.nullable().optional(),
    dueDate: DueDateSchema.nullable().optional(),
  })
  .refine((v) => countPresentFields(v) >= 2, {
    message: "除 expectedVersion 外至少提供一个可修改字段",
  });
export type UpdateTaskDTO = z.infer<typeof UpdateTaskSchema>;

/** VersionInput：仅需 expectedVersion 的请求体（如恢复任务）。 */
export const VersionInputSchema = z.strictObject({
  expectedVersion: VersionSchema,
});
export type VersionInputDTO = z.infer<typeof VersionInputSchema>;

/** DeletedTask：删除任务响应。 */
export const DeletedTaskSchema = z.strictObject({
  id: UuidSchema,
  version: VersionSchema,
  deletedAt: IsoDateTimeSchema,
});
export type DeletedTaskDTO = z.infer<typeof DeletedTaskSchema>;

/** MoveTask：POST /tasks/{id}/move 请求体（乐观并发 + 看板版本）。 */
export const MoveTaskSchema = z.strictObject({
  expectedVersion: VersionSchema,
  expectedBoardVersion: VersionSchema,
  toStatus: TaskStatusSchema,
  beforeTaskId: UuidSchema.nullable(),
});
export type MoveTaskDTO = z.infer<typeof MoveTaskSchema>;

/** MoveResult：move 成功 data（{task, boardVersion}，docs/05 §7）。 */
export const MoveResultSchema = z.strictObject({
  task: TaskSchema,
  boardVersion: VersionSchema,
});
export type MoveResultDTO = z.infer<typeof MoveResultSchema>;

/* ── 看板 ─────────────────────────────────────────────────────────────── */

/** BoardColumn：单列（status + total + items + 该列 nextCursor，docs/05 §6）。 */
export const BoardColumnSchema = z.strictObject({
  status: TaskStatusSchema,
  total: z.number().int().min(0),
  items: z.array(TaskSummarySchema),
  nextCursor: CursorSchema.nullable(),
});
export type BoardColumnDTO = z.infer<typeof BoardColumnSchema>;

/** Board：看板快照（boardVersion + 三列）。 */
export const BoardSchema = z.strictObject({
  boardVersion: VersionSchema,
  columns: z.array(BoardColumnSchema),
});
export type BoardDTO = z.infer<typeof BoardSchema>;

/* ── 子任务 ───────────────────────────────────────────────────────────── */

/** Subtask：子任务 DTO（自维护 version，docs/05 §5）。 */
export const SubtaskSchema = z.strictObject({
  id: UuidSchema,
  taskId: UuidSchema,
  title: z.string().min(1).max(200),
  isCompleted: z.boolean(),
  version: VersionSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type SubtaskDTO = z.infer<typeof SubtaskSchema>;

/** CreateSubtask：required:[title]。 */
export const CreateSubtaskSchema = z.strictObject({
  title: z.string().min(1).max(200),
});
export type CreateSubtaskDTO = z.infer<typeof CreateSubtaskSchema>;

/** UpdateSubtask：expectedVersion 必填 + minProperties:2。 */
export const UpdateSubtaskSchema = z
  .strictObject({
    expectedVersion: VersionSchema,
    title: z.string().min(1).max(200).optional(),
    isCompleted: z.boolean().optional(),
  })
  .refine((v) => countPresentFields(v) >= 2, {
    message: "除 expectedVersion 外至少提供一个可修改字段",
  });
export type UpdateSubtaskDTO = z.infer<typeof UpdateSubtaskSchema>;

/* ── 评论 ─────────────────────────────────────────────────────────────── */

/** Comment：评论 DTO。删除后 body 置 null 且 isDeleted=true（保留占位）。 */
export const CommentSchema = z.strictObject({
  id: UuidSchema,
  taskId: UuidSchema,
  author: UserSummarySchema,
  body: z.string().min(1).max(2000).nullable(),
  isDeleted: z.boolean(),
  version: VersionSchema,
  editedAt: NullableIsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type CommentDTO = z.infer<typeof CommentSchema>;

/** CreateComment：required:[body]。 */
export const CreateCommentSchema = z.strictObject({
  body: z.string().min(1).max(2000),
});
export type CreateCommentDTO = z.infer<typeof CreateCommentSchema>;

/** UpdateComment：expectedVersion 与 body 皆必填。 */
export const UpdateCommentSchema = z.strictObject({
  expectedVersion: VersionSchema,
  body: z.string().min(1).max(2000),
});
export type UpdateCommentDTO = z.infer<typeof UpdateCommentSchema>;

/* ── 附件 ─────────────────────────────────────────────────────────────── */

/** Attachment：附件 DTO。不含 objectKey / signed URL（下载走 Download，docs/05 §8）。 */
export const AttachmentSchema = z.strictObject({
  id: UuidSchema,
  taskId: UuidSchema,
  uploader: UserSummarySchema,
  uploadId: UuidSchema,
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: AttachmentSizeSchema.nullable(),
  declaredSizeBytes: AttachmentSizeSchema,
  state: AttachmentStateSchema,
  errorCode: z.string().min(1).max(80).nullable(),
  createdAt: IsoDateTimeSchema,
});
export type AttachmentDTO = z.infer<typeof AttachmentSchema>;

/**
 * UploadAttachment 的元信息部分（uploadId/declaredSizeBytes/sha256）。
 *
 * openapi 的 UploadAttachment 还含 `file`(format:binary)：附件走 multipart/form-data，
 * 文件二进制不经 JSON Zod 校验，而由服务端流式读取并按上传规则验证（docs/05 §8、docs/03 §7）。
 * 故此 schema 只覆盖可用 JSON 表达并校验的元信息字段，不臆造 file 的运行时校验。
 */
export const UploadAttachmentMetaSchema = z.strictObject({
  uploadId: UuidSchema,
  declaredSizeBytes: AttachmentSizeSchema,
  sha256: Sha256Schema,
});
export type UploadAttachmentMetaDTO = z.infer<typeof UploadAttachmentMetaSchema>;

/** Download：下载端点返回 { url(signed,不持久化), expiresAt, fileName }。 */
export const DownloadSchema = z.strictObject({
  url: z.url(),
  expiresAt: IsoDateTimeSchema,
  fileName: z.string().min(1).max(255),
});
export type DownloadDTO = z.infer<typeof DownloadSchema>;

/* ── 活动 ─────────────────────────────────────────────────────────────── */

/** ActivityMetadata：活动附加信息，全部字段可选（openapi 无 required）。 */
export const ActivityMetadataSchema = z.strictObject({
  taskIdentifier: z.string().max(40).optional(),
  fields: z.array(ActivityMetadataFieldSchema).optional(),
  fromStatus: TaskStatusSchema.optional(),
  toStatus: TaskStatusSchema.optional(),
  targetUserId: UserIdSchema.optional(),
  count: z.number().int().min(0).optional(),
});
export type ActivityMetadataDTO = z.infer<typeof ActivityMetadataSchema>;

/** Activity：项目活动条目（docs/05 §9 动作全集见 ACTIVITY_ACTION）。 */
export const ActivitySchema = z.strictObject({
  id: UuidSchema,
  projectId: UuidSchema,
  actor: UserSummarySchema,
  entityType: ActivityEntityTypeSchema,
  entityId: z.string().min(1).max(128),
  action: ActivityActionSchema,
  metadata: ActivityMetadataSchema,
  createdAt: IsoDateTimeSchema,
});
export type ActivityDTO = z.infer<typeof ActivitySchema>;

/* ── 今日概览 ─────────────────────────────────────────────────────────── */

/** Overview：GET /me/overview 的计数概览（today 为 date-only）。 */
export const OverviewSchema = z.strictObject({
  timezone: z.string().min(1).max(100),
  today: IsoDateSchema,
  overdue: z.number().int().min(0),
  dueToday: z.number().int().min(0),
  upcoming: z.number().int().min(0),
  inProgress: z.number().int().min(0),
  totalOpen: z.number().int().min(0),
});
export type OverviewDTO = z.infer<typeof OverviewSchema>;

/** Workbench：GET /workbench 的任务工作台数据（包含 counts + tasks list）。 */
export const WorkbenchSchema = z.strictObject({
  timezone: z.string().min(1).max(100),
  today: IsoDateSchema,
  overdue: z.number().int().min(0),
  dueToday: z.number().int().min(0),
  upcoming: z.number().int().min(0),
  inProgress: z.number().int().min(0),
  totalOpen: z.number().int().min(0),
  tasks: z.array(TaskSummarySchema),
});
export type WorkbenchDTO = z.infer<typeof WorkbenchSchema>;

/* ── 查询参数 schemas（对齐 paths 内联 parameters）────────────────────── */

/**
 * 查询参数中的布尔值：URL 传输为字符串，显式接受 "true"/"false" 再转换，
 * 避免 `Boolean("false") === true` 陷阱（openapi 中 unassigned/overdue 为 boolean）。
 */
export const BooleanQuerySchema = z.enum(["true", "false"]).transform((v) => v === "true");

/** 游标分页公共参数：cursor(1–2048) 可选、limit(1–100) 可选（服务端默认 30，docs/05 §6）。 */
export const PaginationQuerySchema = z.strictObject({
  cursor: CursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type PaginationQueryDTO = z.infer<typeof PaginationQuerySchema>;

/** listProjects 查询参数。 */
export const ProjectListQuerySchema = PaginationQuerySchema.extend({
  scope: ProjectListScopeSchema.optional(),
  archived: ListVisibilityFilterSchema.optional(),
});
export type ProjectListQueryDTO = z.infer<typeof ProjectListQuerySchema>;

/**
 * listProjectTasks 查询参数。assigneeId 与 unassigned=true 互斥属业务规则，
 * 由服务端校验（docs/05 §6），此处只做形状/类型校验。
 */
export const TaskListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().min(0).max(100).optional(),
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  assigneeId: UserIdSchema.optional(),
  unassigned: BooleanQuerySchema.optional(),
  overdue: BooleanQuerySchema.optional(),
  deleted: ListVisibilityFilterSchema.optional(),
  sort: TaskSortSchema.optional(),
});
export type TaskListQueryDTO = z.infer<typeof TaskListQuerySchema>;

/** Board status selects a column; cursor must refer to that column's original snapshot. */
export const BoardQuerySchema = TaskListQuerySchema.omit({ deleted: true, sort: true }).refine(
  value => !value.cursor || Boolean(value.status),
  { message: "列分页需要 status", path: ["status"] },
);
export type BoardQueryDTO = z.infer<typeof BoardQuerySchema>;
