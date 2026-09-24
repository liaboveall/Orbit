import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import {
  ACTIVITY_ACTION,
  ACTIVITY_ENTITY_TYPE,
  ATTACHMENT_STATE,
  ActivityMetadataSchema,
  ActivitySchema,
  AttachmentSchema,
  BoardColumnSchema,
  BoardSchema,
  CommentSchema,
  CreateCommentSchema,
  CreateProjectSchema,
  CreateSubtaskSchema,
  CreateTaskSchema,
  DeletedTaskSchema,
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
  UpdateCommentSchema,
  UpdateMeSchema,
  UpdateProjectSchema,
  UpdateSubtaskSchema,
  UpdateTaskSchema,
  UserSchema,
  UserSummarySchema,
  VersionInputSchema,
  MetaSchema,
  AcceptedInvitationSchema,
  CreatedInvitationSchema,
  InvitePreviewSchema,
  InviteTokenSchema,
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
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  enum?: unknown[];
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  format?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  minProperties?: number;
  pattern?: string;
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
  ["getAttachmentContent", "get", "/attachments/{attachmentId}/content"],
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

  it("M0–M5 的契约操作均有实际 HTTP route 导出", () => {
    const implemented=operations;
    expect(implemented).toHaveLength(37);
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
    expect(actualIds).toHaveLength(37);
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

  it("BoardColumn.status 枚举与 Task.status 一致（E3 勘误补充的盲区）", () => {
    expect(openApiPropEnum("BoardColumn", "status")).toEqual(openApiPropEnum("Task", "status"));
    expect([...TASK_STATUS]).toEqual(openApiPropEnum("BoardColumn", "status"));
  });

  it("AcceptedInvitation 与 openapi 公开字段一致（C2 修复后不再含 createdNewMembership）", () => {
    expect(zodShapeKeys(AcceptedInvitationSchema)).toEqual(openApiPropNames("AcceptedInvitation"));
    expect(openApiPropNames("AcceptedInvitation")).toEqual(["alreadyMember", "projectId"]);
  });
});

/* ── 深度一致性（E3）：type / required / nullable / enum / format / additionalProperties / 约束 ──
 *
 * 既有断言只比字段名；本节对每条 (openapi schema ↔ Zod schema) 逐属性做行为探测：
 *  - required ↔ Zod optional（safeParse(undefined)）；
 *  - nullable（type:[T,"null"] / anyOf[...,null]）↔ safeParse(null)；
 *  - 合法探测值通过、错类型值失败；
 *  - enum 全成员通过、非成员失败；
 *  - format uuid/date/date-time/uri 的合法与非法样本；
 *  - minLength/maxLength/minimum/maximum 边界值失败（约束漂移可被捕获）；
 *  - additionalProperties:false ↔ strictObject（多余键失败）。
 *
 * 探测值由 openapi 侧 schema 生成（单一事实来源的互验，而非 Zod→openapi 反推）。
 */

const PROBE_UUID = "00000000-0000-4000-8000-000000000000";
const PROBE_DATE = "2026-01-01";
const PROBE_DATETIME = "2026-01-01T00:00:00.000Z";
const PROBE_URI = "https://orbit.example.com/download";
const PROBE_EMAIL = "user@orbit.example.com";
const PROBE_EXTRA_KEY = "__orbit_extra_probe__";

function resolveRefDeep(schema: JsonSchema): JsonSchema {
  let s = schema;
  while (s?.$ref) {
    const name = s.$ref.split("/").pop()!;
    s = doc.components.schemas[name] ?? {};
  }
  return s ?? {};
}

/** 去掉 null 成员：type 数组取非 null 项；anyOf 取非 null 分支。 */
function nonNullSchema(schema: JsonSchema): JsonSchema {
  const s = resolveRefDeep(schema);
  if (Array.isArray(s.type)) {
    const t = s.type.find((x) => x !== "null");
    return { ...s, type: t };
  }
  if (s.anyOf) {
    const member = s.anyOf.find((m) => {
      const r = resolveRefDeep(m);
      const type = Array.isArray(r.type) ? r.type.find((x) => x !== "null") : r.type;
      return type !== "null" && type !== undefined;
    });
    return resolveRefDeep(member ?? {});
  }
  return s;
}

function isNullableSchema(schema: JsonSchema): boolean {
  const s = resolveRefDeep(schema);
  if (Array.isArray(s.type)) return s.type.includes("null");
  if (s.anyOf) {
    return s.anyOf.some((m) => {
      const r = resolveRefDeep(m);
      return Array.isArray(r.type) ? r.type.includes("null") : r.type === "null";
    });
  }
  return false;
}

/** 依据 openapi pattern 生成可匹配样本（有限候选表，行为可审阅）。 */
function probeStringWithPattern(pattern: string): string {
  const samples = [
    "ABC",
    "ABCD",
    "ABC123",
    "ab",
    "abc",
    "a1b2c3",
    "a-b",
    "a_b",
    "Sample Text",
    "task",
    PROBE_UUID,
    PROBE_URI,
    "a".repeat(64),
    "a".repeat(40),
  ];
  const re = new RegExp(pattern);
  const hit = samples.find((s) => re.test(s));
  if (hit !== undefined) return hit;
  throw new Error(`深度契约探测：未准备 pattern ${pattern} 的样本，请补充候选表`);
}

function probeValid(schema: JsonSchema): unknown {
  const s = resolveRefDeep(schema);
  if (s.enum) return s.enum[0];
  if (s.anyOf) return probeValid(nonNullSchema(s));
  switch (s.type) {
    case "string": {
      if (s.pattern) return probeStringWithPattern(s.pattern);
      if (s.format === "uuid") return PROBE_UUID;
      if (s.format === "date") return PROBE_DATE;
      if (s.format === "date-time") return PROBE_DATETIME;
      if (s.format === "uri") return PROBE_URI;
      if (s.format === "email") return PROBE_EMAIL;
      const len = Math.max(s.minLength ?? 1, 1);
      return "a".repeat(len);
    }
    case "integer":
    case "number":
      return s.minimum ?? 0;
    case "boolean":
      return false;
    case "array": {
      const count = Math.max(s.minItems ?? 1, 1);
      return Array.from({ length: count }, () => probeValid(s.items ?? {}));
    }
    case "object": {
      const props = s.properties ?? {};
      const result: Record<string, unknown> = {};
      for (const key of s.required ?? []) {
        if (props[key]) result[key] = probeValid(props[key]);
      }
      // minProperties>0 且无 required（如 UpdateMe）：补第一个属性样本。
      if (Object.keys(result).length === 0 && (s.minProperties ?? 0) > 0) {
        const first = Object.keys(props)[0];
        if (first && props[first]) result[first] = probeValid(props[first]);
      }
      return result;
    }
    default:
      return null;
  }
}

function probeWrongType(schema: JsonSchema): unknown | undefined {
  const s = nonNullSchema(schema);
  switch (s.type) {
    case "string":
      return 0;
    case "integer":
    case "number":
      return "not-a-number";
    case "boolean":
      return "not-boolean";
    case "array":
      return { notAnArray: true };
    case "object":
      return ["not-an-object"];
    default:
      return undefined;
  }
}

/**
 * 单属性深度对齐断言。zodProp 是该属性位置的 Zod schema；jsonProp 是 openapi 属性 schema；
 * parentRequired 是**父对象**的 required 数组（required 归属父对象，不能从属性 schema 自身取）。
 * 断言失败消息统一带 schema/属性名与探测值，便于定位漂移方向。
 */
function expectPropertyAligned(
  zodProp: ZodType,
  schemaName: string,
  propName: string,
  jsonProp: JsonSchema,
  parentRequired: string[],
): void {
  const label = `${schemaName}.${propName}`;
  const s = resolveRefDeep(jsonProp);

  // required ↔ optional
  const acceptsUndefined = zodProp.safeParse(undefined).success;
  const requiredFlag = parentRequired.includes(propName);
  expect(acceptsUndefined, `${label}: required=${requiredFlag} ↔ Zod optional 不一致`).toBe(
    !requiredFlag,
  );

  // nullable ↔ null
  const nullable = isNullableSchema(jsonProp);
  expect(zodProp.safeParse(null).success, `${label}: nullable=${nullable} ↔ Zod null 不一致`).toBe(
    nullable,
  );

  // 合法探测值必须通过
  const base = nonNullSchema(jsonProp);
  const valid = probeValid(base);
  const validResult = zodProp.safeParse(valid);
  expect(
    validResult.success,
    `${label}: openapi 合法探测值 ${JSON.stringify(valid)} 未通过 Zod：${JSON.stringify(validResult.error?.issues?.[0])}`,
  ).toBe(true);

  // 错类型值必须失败
  const wrong = probeWrongType(base);
  if (wrong !== undefined) {
    expect(
      zodProp.safeParse(wrong).success,
      `${label}: openapi 类型 ${String(base.type)} 的错类型探测值 ${JSON.stringify(wrong)} 被 Zod 接受`,
    ).toBe(false);
  }

  // enum：全成员通过、非成员失败
  if (s.enum) {
    for (const v of s.enum) {
      expect(zodProp.safeParse(v).success, `${label}: 枚举值 ${String(v)} 未通过`).toBe(true);
    }
    expect(zodProp.safeParse("__orbit_not_in_enum__").success, `${label}: 非枚举值被接受`).toBe(
      false,
    );
  }

  // format：合法/非法样本
  if (base.format === "uuid") {
    expect(zodProp.safeParse("not-a-uuid").success, `${label}: 非法 uuid 被接受`).toBe(false);
  }
  if (base.format === "date") {
    expect(
      zodProp.safeParse(PROBE_DATETIME).success,
      `${label}: date-only 字段接受了 datetime`,
    ).toBe(false);
  }
  if (base.format === "date-time") {
    expect(zodProp.safeParse(PROBE_DATE).success, `${label}: datetime 字段接受了 date-only`).toBe(
      false,
    );
  }
  if (base.format === "uri") {
    expect(zodProp.safeParse("not a url").success, `${label}: 非法 uri 被接受`).toBe(false);
  }

  // 约束边界
  if (typeof base.minLength === "number" && base.minLength > 0) {
    expect(
      zodProp.safeParse("a".repeat(base.minLength - 1)).success,
      `${label}: minLength=${base.minLength} 边界值被接受`,
    ).toBe(false);
  }
  if (typeof base.maxLength === "number") {
    expect(
      zodProp.safeParse("a".repeat(base.maxLength + 1)).success,
      `${label}: maxLength=${base.maxLength} 边界值被接受`,
    ).toBe(false);
  }
  if (typeof base.minimum === "number" && !s.enum) {
    expect(
      zodProp.safeParse(base.minimum - 1).success,
      `${label}: minimum=${base.minimum} 边界值被接受`,
    ).toBe(false);
  }
  if (typeof base.maximum === "number" && !s.enum) {
    expect(
      zodProp.safeParse(base.maximum + 1).success,
      `${label}: maximum=${base.maximum} 边界值被接受`,
    ).toBe(false);
  }
}

/** 对象级断言：所有属性对齐 + additionalProperties:false ↔ strictObject（或 map 语义）。 */
function expectSchemaDeepAligned(zodSchema: ZodType & { shape: Record<string, ZodType> }, schemaName: string): void {
  const s = resolveRefDeep(schemaOf(schemaName));
  const props = s.properties ?? {};

  for (const [propName, jsonProp] of Object.entries(props)) {
    const zodProp = zodSchema.shape[propName];
    if (!zodProp) continue; // 字段名集合已由上一节断言，这里只深查交集。
    expectPropertyAligned(zodProp, schemaName, propName, jsonProp, s.required ?? []);
  }

  const ap = s.additionalProperties;
  if (ap === false) {
    const probe = { ...(probeValid(s) as object), [PROBE_EXTRA_KEY]: "__extra__" };
    expect(
      zodSchema.safeParse(probe).success,
      `${schemaName}: openapi additionalProperties:false 但 Zod 接受多余键`,
    ).toBe(false);
  } else if (ap && typeof ap === "object" && !Array.isArray(ap)) {
    // map 语义（如 Error.fieldErrors）：任意键 + 合法值应通过。
    const mapProbe = { __probe_key__: probeValid(ap) };
    expect(zodSchema.safeParse(mapProbe).success, `${schemaName}: map additionalProperties 值被拒`).toBe(true);
  }
}

describe("openapi ↔ Zod 深度一致性（E3）", () => {
  it.each([
    ["Meta", MetaSchema],
    ["PageMeta", PageMetaSchema],
    ["User", UserSchema],
    ["UserSummary", UserSummarySchema],
    ["Project", ProjectSchema],
    ["Task", TaskSchema],
    ["TaskSummary", TaskSummarySchema],
    ["Member", MemberSchema],
    ["Invitation", InvitationSchema],
    ["CreatedInvitation", CreatedInvitationSchema],
    ["InvitePreview", InvitePreviewSchema],
    ["AcceptedInvitation", AcceptedInvitationSchema],
    ["DeletedTask", DeletedTaskSchema],
    ["MoveTask", MoveTaskSchema],
    ["MoveResult", MoveResultSchema],
    ["Board", BoardSchema],
    ["BoardColumn", BoardColumnSchema],
    ["Subtask", SubtaskSchema],
    ["Comment", CommentSchema],
    ["Attachment", AttachmentSchema],
    ["Download", DownloadSchema],
    ["Activity", ActivitySchema],
    ["ActivityMetadata", ActivityMetadataSchema],
    ["Overview", OverviewSchema],
  ] as const)("响应 %s：逐属性 type/required/nullable/enum/format/约束对齐", (name, zod) => {
    expectSchemaDeepAligned(zod, name);
  });

  it.each([
    ["UpdateMe", UpdateMeSchema],
    ["CreateProject", CreateProjectSchema],
    ["UpdateProject", UpdateProjectSchema],
    ["InviteToken", InviteTokenSchema],
    ["CreateTask", CreateTaskSchema],
    ["UpdateTask", UpdateTaskSchema],
    ["VersionInput", VersionInputSchema],
    ["CreateSubtask", CreateSubtaskSchema],
    ["UpdateSubtask", UpdateSubtaskSchema],
    ["CreateComment", CreateCommentSchema],
    ["UpdateComment", UpdateCommentSchema],
  ] as const)("请求 %s：逐属性 type/required/nullable/enum/format/约束对齐", (name, zod) => {
    expectSchemaDeepAligned(zod, name);
  });

  it("Error 信封：嵌套 error 对象与 ErrorResponse/ErrorDetail 深度对齐", () => {
    expectSchemaDeepAligned(ErrorResponseSchema, "Error");
    const errorProp = resolveRefDeep(schemaOf("Error").properties!.error!);
    for (const [propName, jsonProp] of Object.entries(errorProp.properties ?? {})) {
      const zodProp = (ErrorDetailSchema.shape as Record<string, ZodType>)[propName];
      if (!zodProp) continue;
      expectPropertyAligned(zodProp, "Error.error", propName, jsonProp, errorProp.required ?? []);
    }
  });

  it("UploadAttachment 为 multipart 表单，不参与 JSON 深度比对（记录豁免）", () => {
    const upload = resolveRefDeep(schemaOf("UploadAttachment"));
    expect(upload.type).toBe("object");
  });
});
