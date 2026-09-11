import { z } from "zod";

/**
 * 契约层枚举（ORB-003）。
 *
 * 每个枚举导出三件套：
 *  1. `X` —— `as const` 只读元组，供运行时/测试直接取值与遍历；
 *  2. `XSchema` —— Zod enum，用于运行时校验（AGENTS.md：外部输入统一 schema 校验）；
 *  3. `X`（type） —— 由元组派生的联合类型，供 DTO/客户端类型安全使用。
 *
 * 所有取值严格对齐 contracts/openapi.json 中 components/schemas 与 paths 的 enum 定义，
 * 未出现于契约的取值一律不臆造。本模块无服务端依赖，可进入客户端 bundle。
 */

/* ── 项目 ─────────────────────────────────────────────────────────────── */

/** Project.color / CreateProject.color / UpdateProject.color。 */
export const PROJECT_COLOR = ["BLUE", "PURPLE", "TEAL", "GREEN", "ORANGE", "GRAY"] as const;
export const ProjectColorSchema = z.enum(PROJECT_COLOR);
export type ProjectColor = (typeof PROJECT_COLOR)[number];

/**
 * Project.role / Member.role —— 计算得到的 OWNER/MEMBER，不写回数据库（docs/05 §4）。
 */
export const PROJECT_ROLE = ["OWNER", "MEMBER"] as const;
export const ProjectRoleSchema = z.enum(PROJECT_ROLE);
export type ProjectRole = (typeof PROJECT_ROLE)[number];

/** listProjects 的 scope 查询参数。 */
export const PROJECT_LIST_SCOPE = ["all", "owned", "joined"] as const;
export const ProjectListScopeSchema = z.enum(PROJECT_LIST_SCOPE);
export type ProjectListScope = (typeof PROJECT_LIST_SCOPE)[number];

/* ── 任务 ─────────────────────────────────────────────────────────────── */

/** Task.status / MoveTask.toStatus / ActivityMetadata.fromStatus|toStatus。 */
export const TASK_STATUS = ["TODO", "IN_PROGRESS", "DONE"] as const;
export const TaskStatusSchema = z.enum(TASK_STATUS);
export type TaskStatus = (typeof TASK_STATUS)[number];

/** Task.priority。排序权重 HIGH→MEDIUM→LOW→NONE（docs/05 §6）。 */
export const TASK_PRIORITY = ["NONE", "LOW", "MEDIUM", "HIGH"] as const;
export const TaskPrioritySchema = z.enum(TASK_PRIORITY);
export type TaskPriority = (typeof TASK_PRIORITY)[number];

/** listProjectTasks / listMyTasks 的 sort 查询参数。 */
export const TASK_SORT = ["updated_desc", "due_asc", "priority_desc"] as const;
export const TaskSortSchema = z.enum(TASK_SORT);
export type TaskSort = (typeof TASK_SORT)[number];

/** archived / deleted 过滤：exclude（默认排除）或 only（只返回）。 */
export const LIST_VISIBILITY_FILTER = ["exclude", "only"] as const;
export const ListVisibilityFilterSchema = z.enum(LIST_VISIBILITY_FILTER);
export type ListVisibilityFilter = (typeof LIST_VISIBILITY_FILTER)[number];

/* ── 邀请 ─────────────────────────────────────────────────────────────── */

/** Invitation.state。 */
export const INVITATION_STATE = ["ACTIVE", "EXPIRED", "REVOKED", "USED"] as const;
export const InvitationStateSchema = z.enum(INVITATION_STATE);
export type InvitationState = (typeof INVITATION_STATE)[number];

/** InvitePreview.role —— 匿名预览只可能是 MEMBER（openapi 单值 enum）。 */
export const INVITE_PREVIEW_ROLE = ["MEMBER"] as const;
export const InvitePreviewRoleSchema = z.enum(INVITE_PREVIEW_ROLE);
export type InvitePreviewRole = (typeof INVITE_PREVIEW_ROLE)[number];

/* ── 附件 ─────────────────────────────────────────────────────────────── */

/** Attachment.state（列表不返回 DELETED，故 DTO enum 仅这三值，docs/05 §8）。 */
export const ATTACHMENT_STATE = ["UPLOADING", "READY", "FAILED"] as const;
export const AttachmentStateSchema = z.enum(ATTACHMENT_STATE);
export type AttachmentState = (typeof ATTACHMENT_STATE)[number];

/* ── 活动 ─────────────────────────────────────────────────────────────── */

/** Activity.entityType。 */
export const ACTIVITY_ENTITY_TYPE = [
  "PROJECT",
  "MEMBER",
  "TASK",
  "SUBTASK",
  "COMMENT",
  "ATTACHMENT",
] as const;
export const ActivityEntityTypeSchema = z.enum(ACTIVITY_ENTITY_TYPE);
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPE)[number];

/** Activity.action —— docs/05 §9 全表（20 项）。 */
export const ACTIVITY_ACTION = [
  "PROJECT_CREATED",
  "PROJECT_UPDATED",
  "PROJECT_ARCHIVED",
  "PROJECT_RESTORED",
  "MEMBER_JOINED",
  "MEMBER_LEFT",
  "MEMBER_REMOVED",
  "TASK_CREATED",
  "TASK_UPDATED",
  "TASK_MOVED",
  "TASK_DELETED",
  "TASK_RESTORED",
  "SUBTASK_CREATED",
  "SUBTASK_UPDATED",
  "SUBTASK_DELETED",
  "COMMENT_CREATED",
  "COMMENT_UPDATED",
  "COMMENT_DELETED",
  "FILE_UPLOADED",
  "FILE_DELETED",
] as const;
export const ActivityActionSchema = z.enum(ACTIVITY_ACTION);
export type ActivityAction = (typeof ACTIVITY_ACTION)[number];

/** ActivityMetadata.fields[] —— 变更涉及的字段名白名单。 */
export const ACTIVITY_METADATA_FIELD = [
  "name",
  "description",
  "color",
  "title",
  "status",
  "priority",
  "assigneeId",
  "dueDate",
  "isCompleted",
  "body",
] as const;
export const ActivityMetadataFieldSchema = z.enum(ACTIVITY_METADATA_FIELD);
export type ActivityMetadataField = (typeof ACTIVITY_METADATA_FIELD)[number];
