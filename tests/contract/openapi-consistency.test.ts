import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_ACTION,
  ACTIVITY_ENTITY_TYPE,
  ATTACHMENT_STATE,
  ActivitySchema,
  AttachmentSchema,
  BoardColumnSchema,
  BoardSchema,
  CommentSchema,
  DownloadSchema,
  ErrorDetailSchema,
  ErrorResponseSchema,
  INVITATION_STATE,
  InvitationSchema,
  MemberSchema,
  MoveResultSchema,
  MoveTaskSchema,
  OverviewSchema,
  PROJECT_COLOR,
  PROJECT_ROLE,
  PageMetaSchema,
  ProjectSchema,
  SubtaskSchema,
  TASK_PRIORITY,
  TASK_STATUS,
  TaskSchema,
  TaskSummarySchema,
  UserSchema,
  UserSummarySchema,
  MetaSchema,
} from "@/contracts";

/**
 * OpenAPI ↔ Zod 契约一致性测试（ORB-003）。
 *
 * 三类断言：
 *  1. paths：每个 operationId 的 method + path 与 openapi.json 完全一致（下表逐条抄录）。
 *  2. components/schemas：关键 DTO 的字段名集合与 Zod shape 一致（不多不少）。
 *  3. 枚举：Zod 枚举取值与 openapi enum 一致。
 * 保证契约（openapi）、运行时 schema（Zod）与文档（docs/05）三者同步（AGENTS.md）。
 */

const openApiPath = fileURLToPath(new URL("../../contracts/openapi.json", import.meta.url));

interface JsonSchema {
  type?: unknown;
  properties?: Record<string, JsonSchema>;
  enum?: unknown[];
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  format?: string;
}
interface Operation {
  operationId?: string;
}
interface OpenApiDoc {
  openapi: string;
  components: { schemas: Record<string, JsonSchema> };
  paths: Record<string, Record<string, Operation>>;
}

const doc = JSON.parse(readFileSync(openApiPath, "utf8")) as OpenApiDoc;

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "trace"];

/** openapi.json 中全部 operationId → method + path（逐条抄录，作为期望真源）。 */
const EXPECTED_OPERATIONS: Array<[operationId: string, method: string, path: string]> = [
  ["getMe", "get", "/me"],
  ["updateMe", "patch", "/me"],
  ["listProjects", "get", "/projects"],
  ["createProject", "post", "/projects"],
  ["getProject", "get", "/projects/{projectId}"],
  ["updateProject", "patch", "/projects/{projectId}"],
  ["listMembers", "get", "/projects/{projectId}/members"],
  ["removeMember", "delete", "/projects/{projectId}/members/{userId}"],
  ["listInvitations", "get", "/projects/{projectId}/invitations"],
  ["createInvitation", "post", "/projects/{projectId}/invitations"],
  ["revokeInvitation", "delete", "/projects/{projectId}/invitations/{invitationId}"],
  ["previewInvitation", "post", "/invitations/preview"],
  ["acceptInvitation", "post", "/invitations/accept"],
  ["listProjectTasks", "get", "/projects/{projectId}/tasks"],
  ["createTask", "post", "/projects/{projectId}/tasks"],
  ["getBoard", "get", "/projects/{projectId}/board"],
  ["getTask", "get", "/tasks/{taskId}"],
  ["updateTask", "patch", "/tasks/{taskId}"],
  ["deleteTask", "delete", "/tasks/{taskId}"],
  ["restoreTask", "post", "/tasks/{taskId}/restore"],
  ["moveTask", "post", "/tasks/{taskId}/move"],
  ["listSubtasks", "get", "/tasks/{taskId}/subtasks"],
  ["createSubtask", "post", "/tasks/{taskId}/subtasks"],
  ["updateSubtask", "patch", "/subtasks/{subtaskId}"],
  ["deleteSubtask", "delete", "/subtasks/{subtaskId}"],
  ["listComments", "get", "/tasks/{taskId}/comments"],
  ["createComment", "post", "/tasks/{taskId}/comments"],
  ["updateComment", "patch", "/comments/{commentId}"],
  ["deleteComment", "delete", "/comments/{commentId}"],
  ["listAttachments", "get", "/tasks/{taskId}/attachments"],
  ["uploadAttachment", "post", "/tasks/{taskId}/attachments"],
  ["getAttachmentDownload", "get", "/attachments/{attachmentId}/download"],
  ["deleteAttachment", "delete", "/attachments/{attachmentId}"],
  ["listActivity", "get", "/projects/{projectId}/activity"],
  ["getMyOverview", "get", "/my/overview"],
  ["listMyTasks", "get", "/my/tasks"],
];

/** 收集 openapi.json 中所有 operation（method+path+operationId）。 */
function collectOperations(): Array<{ operationId: string; method: string; path: string }> {
  const ops: Array<{ operationId: string; method: string; path: string }> = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.includes(method)) continue;
      if (op.operationId) ops.push({ operationId: op.operationId, method, path });
    }
  }
  return ops;
}

function schemaOf(name: string): JsonSchema {
  const s = doc.components.schemas[name];
  if (!s) throw new Error(`openapi.json 缺少 components/schemas/${name}`);
  return s;
}

function openApiPropNames(name: string): string[] {
  return Object.keys(schemaOf(name).properties ?? {}).sort();
}

function openApiPropEnum(name: string, prop: string): unknown[] {
  return schemaOf(name).properties?.[prop]?.enum ?? [];
}

function zodShapeKeys(schema: { shape: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape).sort();
}

describe("openapi paths：operationId 的 method + path", () => {
  const operations = collectOperations();
  const byId = new Map(operations.map((o) => [o.operationId, o]));

  it("M0–M4 的契约操作均有实际 HTTP route 导出", () => {
    const deferred = new Set([
      "listSubtasks", "createSubtask", "updateSubtask", "deleteSubtask",
      "listComments", "createComment", "updateComment", "deleteComment",
      "listAttachments", "uploadAttachment", "getAttachmentDownload", "deleteAttachment",
      "getMyOverview", "listMyTasks",
    ]);
    const implemented = operations.filter((op) => !deferred.has(op.operationId));
    expect(implemented).toHaveLength(22);
    for (const op of implemented) {
      const route = op.path.replace(/\{([^}]+)\}/g, "[$1]");
      const source = readFileSync(new URL(`../../src/app/api/v1${route}/route.ts`, import.meta.url), "utf8");
      expect(source, op.operationId).toMatch(new RegExp(`export\\s+(?:async\\s+)?function\\s+${op.method.toUpperCase()}\\b`));
    }
  });

  it("每个 operation 都有合法 method 且 path 以 / 开头", () => {
    expect(operations.length).toBeGreaterThan(0);
    for (const op of operations) {
      expect(HTTP_METHODS).toContain(op.method);
      expect(op.path.startsWith("/")).toBe(true);
    }
  });

  it("operationId 全局唯一", () => {
    const ids = operations.map((o) => o.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("期望表中的每个 operationId 都以正确 method+path 存在于契约中", () => {
    for (const [operationId, method, path] of EXPECTED_OPERATIONS) {
      const found = byId.get(operationId);
      expect(found, `缺少 operationId: ${operationId}`).toBeDefined();
      expect(found?.method, `${operationId} method`).toBe(method);
      expect(found?.path, `${operationId} path`).toBe(path);
    }
  });

  it("契约未出现期望表之外的 operationId（无遗漏同步）", () => {
    const expectedIds = EXPECTED_OPERATIONS.map(([id]) => id).sort();
    const actualIds = operations.map((o) => o.operationId).sort();
    expect(actualIds).toEqual(expectedIds);
    expect(actualIds).toHaveLength(36);
  });
});

describe("components/schemas ↔ Zod shape：字段名一致", () => {
  const cases: Array<[name: string, zodKeys: string[]]> = [
    ["Meta", zodShapeKeys(MetaSchema)],
    ["PageMeta", zodShapeKeys(PageMetaSchema)],
    ["User", zodShapeKeys(UserSchema)],
    ["UserSummary", zodShapeKeys(UserSummarySchema)],
    ["Project", zodShapeKeys(ProjectSchema)],
    ["Task", zodShapeKeys(TaskSchema)],
    ["TaskSummary", zodShapeKeys(TaskSummarySchema)],
    ["Member", zodShapeKeys(MemberSchema)],
    ["Invitation", zodShapeKeys(InvitationSchema)],
    ["MoveTask", zodShapeKeys(MoveTaskSchema)],
    ["MoveResult", zodShapeKeys(MoveResultSchema)],
    ["Board", zodShapeKeys(BoardSchema)],
    ["BoardColumn", zodShapeKeys(BoardColumnSchema)],
    ["Subtask", zodShapeKeys(SubtaskSchema)],
    ["Comment", zodShapeKeys(CommentSchema)],
    ["Attachment", zodShapeKeys(AttachmentSchema)],
    ["Download", zodShapeKeys(DownloadSchema)],
    ["Activity", zodShapeKeys(ActivitySchema)],
    ["Overview", zodShapeKeys(OverviewSchema)],
  ];

  it.each(cases)("schema %s 的字段名集合与 openapi 一致", (name, zodKeys) => {
    expect(zodKeys).toEqual(openApiPropNames(name));
  });

  it("ErrorResponse 顶层字段 = openapi Error 顶层字段", () => {
    expect(zodShapeKeys(ErrorResponseSchema)).toEqual(openApiPropNames("Error"));
  });

  it("ErrorDetail 字段 = openapi Error.properties.error 的字段", () => {
    const nested = schemaOf("Error").properties?.error;
    const openApiKeys = Object.keys(nested?.properties ?? {}).sort();
    expect(zodShapeKeys(ErrorDetailSchema)).toEqual(openApiKeys);
  });
});

describe("枚举 ↔ openapi enum 一致", () => {
  it("Task.status / priority", () => {
    expect([...TASK_STATUS]).toEqual(openApiPropEnum("Task", "status"));
    expect([...TASK_PRIORITY]).toEqual(openApiPropEnum("Task", "priority"));
  });

  it("Project.color / role", () => {
    expect([...PROJECT_COLOR]).toEqual(openApiPropEnum("Project", "color"));
    expect([...PROJECT_ROLE]).toEqual(openApiPropEnum("Project", "role"));
  });

  it("Invitation.state / Attachment.state", () => {
    expect([...INVITATION_STATE]).toEqual(openApiPropEnum("Invitation", "state"));
    expect([...ATTACHMENT_STATE]).toEqual(openApiPropEnum("Attachment", "state"));
  });

  it("Activity.action / entityType（docs/05 §9 全集）", () => {
    expect([...ACTIVITY_ACTION]).toEqual(openApiPropEnum("Activity", "action"));
    expect([...ACTIVITY_ENTITY_TYPE]).toEqual(openApiPropEnum("Activity", "entityType"));
  });

  it("TaskSummary 与 Task 的 status enum 相同（复用同一 TASK_STATUS）", () => {
    expect(openApiPropEnum("TaskSummary", "status")).toEqual(openApiPropEnum("Task", "status"));
  });
});
