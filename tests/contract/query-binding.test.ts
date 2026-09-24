import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z, type ZodType } from "zod";
import { BoardQuerySchema, MyTasksQuerySchema, PaginationQuerySchema, ProjectListQuerySchema,
  SignedDownloadQuerySchema, TaskListQuerySchema, VersionQuerySchema } from "@/contracts/dto";
type Schema = { $ref?: string; type?: string; format?: string; pattern?: string; enum?: string[];
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number; default?: unknown;
  properties?: Record<string, Schema>; items?: Schema; required?: string[]; additionalProperties?: boolean };
type Parameter = { name: string; in: string; required?: boolean; schema: Schema };
type Operation = { operationId: string; parameters?: Parameter[]; responses: Record<string, { $ref?: string; content?: Record<string, { schema: Schema }> }> };
type Document = { paths: Record<string, Record<string, Operation>> };
const load = (): Document => JSON.parse(readFileSync("contracts/openapi.json", "utf8"));
// Independent operation bindings; component DTOs are deeply compared to Zod by openapi-consistency.
const responses: Record<string, [string, "single" | "list" | "page" | "empty" | "binary", string?]> = {
  getMe: ["User", "single"], updateMe: ["User", "single"], listProjects: ["Project", "page"],
  createProject: ["Project", "single", "201"], getProject: ["Project", "single"], updateProject: ["Project", "single"],
  listMembers: ["Member", "list"], removeMember: ["", "empty"], listInvitations: ["Invitation", "page"],
  createInvitation: ["CreatedInvitation", "single", "201"], revokeInvitation: ["", "empty"],
  previewInvitation: ["InvitePreview", "single"], acceptInvitation: ["AcceptedInvitation", "single"],
  listProjectTasks: ["TaskSummary", "page"], createTask: ["Task", "single", "201"], getBoard: ["Board", "single"],
  getTask: ["Task", "single"], updateTask: ["Task", "single"], deleteTask: ["DeletedTask", "single"],
  restoreTask: ["Task", "single"], moveTask: ["MoveResult", "single"], listSubtasks: ["Subtask", "list"],
  createSubtask: ["Subtask", "single", "201"], updateSubtask: ["Subtask", "single"], deleteSubtask: ["", "empty"],
  listComments: ["Comment", "page"], createComment: ["Comment", "single", "201"], updateComment: ["Comment", "single"],
  deleteComment: ["Comment", "single"], listAttachments: ["Attachment", "list"], uploadAttachment: ["Attachment", "single", "201"],
  getAttachmentDownload: ["Download", "single"], deleteAttachment: ["", "empty"], listActivity: ["Activity", "page"],
  getMyOverview: ["Overview", "single"], listMyTasks: ["TaskSummary", "page"], getAttachmentContent: ["", "binary"],
};
const queries: Record<string, { shape: Record<string, ZodType> }> = {
  listProjects: ProjectListQuerySchema, listInvitations: PaginationQuerySchema, listProjectTasks: TaskListQuerySchema,
  getBoard: BoardQuerySchema, listComments: PaginationQuerySchema, listActivity: PaginationQuerySchema,
  listMyTasks: MyTasksQuerySchema, deleteTask: VersionQuerySchema, deleteSubtask: VersionQuerySchema,
  deleteComment: VersionQuerySchema, getAttachmentContent: SignedDownloadQuerySchema,
};
const errors = ["400", "401", "403", "404", "409", "410", "413", "415", "422", "429", "500", "503"];
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
function compare(document: Document) {
  const operations = Object.values(document.paths).flatMap(item => Object.values(item)).filter(op => op.operationId);
  expect(operations.map(op => op.operationId).sort()).toEqual(Object.keys(responses).sort());
  for (const op of operations) {
    const id = op.operationId;
    const [name, kind, extra] = responses[id]!;
    const success = kind === "empty" ? ["204"] : extra ? ["200", extra] : ["200"];
    expect(Object.keys(op.responses).sort(), id).toEqual([...success, ...errors].sort());
    for (const status of errors) expect(op.responses[status], `${id} ${status}`).toEqual({ $ref: "#/components/responses/BusinessError" });
    for (const status of success) {
      const content = op.responses[status]!.content;
      if (kind === "empty") { expect(content).toBeUndefined(); continue; }
      if (kind === "binary") { expect(content).toEqual({ "application/octet-stream": { schema: { type: "string", format: "binary" } } }); continue; }
      expect(content?.["application/json"]?.schema, `${id} ${status}`).toEqual({ type: "object", additionalProperties: false,
        properties: { data: kind === "single" ? ref(name) : { type: "array", items: ref(name) }, meta: ref(kind === "page" ? "PageMeta" : "Meta") }, required: ["data", "meta"] });
    }
    const params = (op.parameters ?? []).filter(p => p.in === "query");
    const fields = queries[id]?.shape ?? {};
    expect(params.map(p => p.name).sort(), id).toEqual(Object.keys(fields).sort());
    for (const p of params) {
      const runtime = fields[p.name]!;
      const s = p.schema;
      const input = z.toJSONSchema(runtime, { io: "input", unrepresentable: "any" });
      if (s.type === "boolean") {
        expect(input.type).toBe("string"); expect(input.enum).toEqual(["true", "false"]);
      } else if (p.name === "expectedVersion") {
        // HTTP query text is lexically validated before conversion to integer.
        expect(input.type).toBe("string"); expect(input.pattern).toBe("^[1-9]\\d*$");
        expect(s).toEqual({ type: "integer", minimum: 1 });
      } else {
        expect(input.type, `${id}.${p.name} type`).toBe(s.type);
        expect(input.enum, `${id}.${p.name} enum`).toEqual(s.enum);
        expect(input.maximum).toBe(s.maximum);
        expect(input.maxLength).toBe(s.maxLength);
        expect(input.minimum).toBe(s.minimum);
        expect(input.minLength ?? 0).toBe(s.minLength ?? 0);
        if (s.format !== "uuid") expect(input.pattern, `${id}.${p.name} pattern`).toBe(s.pattern);
      }
      expect(runtime.safeParse(undefined).success, `${id}.${p.name} required`).toBe(!p.required);
      expect(runtime.safeParse(null).success, `${id}.${p.name} null`).toBe(false);
      const check = (value: unknown, accepted: boolean) => expect(runtime.safeParse(value).success, `${id}.${p.name}: ${String(value).slice(0, 40)}`).toBe(accepted);
      if (p.name === "limit") expect(s.default, `${id} default`).toBe(id === "getBoard" ? 50 : 30);
      else expect(s.default).toBeUndefined();
      if (s.enum) { for (const value of s.enum) check(value, true); check("__invalid_enum__", false); }
      else if (s.type === "integer") {
        expect(s.minimum).toBe(1);
        if (p.name === "limit") expect(s.maximum).toBe(100);
        check(String(s.minimum), true); check(String(s.minimum! - 1), false); check("1.5", false);
        if (s.maximum !== undefined) { check(String(s.maximum), true); check(String(s.maximum + 1), false); }
        const result = runtime.safeParse("1"); expect(result.success && result.data).toBe(1);
      } else if (s.type === "boolean") {
        expect(runtime.safeParse("false")).toMatchObject({ success: true, data: false });
        expect(runtime.safeParse("true")).toMatchObject({ success: true, data: true }); check("yes", false);
      } else if (s.format === "uuid") { check("00000000-0000-4000-8000-000000000000", true); check("invalid", false); }
      else if (s.pattern) {
        const valid = p.name === "expires" ? "1999999999999" : "a".repeat(64);
        expect(new RegExp(s.pattern).test(valid)).toBe(true); check(valid, true); check("invalid", false);
      } else {
        expect(s.type).toBe("string");
        const min = s.minLength ?? 0, max = s.maxLength;
        expect(max).toBeDefined(); check("a".repeat(min), true);
        if (min) check("a".repeat(min - 1), false);
        if (max !== undefined) { check("a".repeat(max), true); check("a".repeat(max + 1), false); }
        check(42, false);
      }
      for (const candidate of ["all", "owned", "joined", "exclude", "only", "TODO", "IN_PROGRESS", "DONE", "NONE", "LOW", "MEDIUM", "HIGH", "updated_desc", "due_asc", "priority_desc", "all_open", "overdue", "today", "upcoming", "in_progress", "done"]) {
        if (s.enum) check(candidate, s.enum.includes(candidate));
      }
    }
  }
}
describe("operation/request/response bindings", () => {
  it("matches every operation, query field and response envelope to its runtime contract", () => compare(load()));
  const mutations: Array<[string, (d: Document) => void]> = [
    ["wrong response DTO", d => { d.paths["/projects"]!.get!.responses["200"]!.content!["application/json"]!.schema.properties!.data!.items = ref("Task"); }],
    ["missing error envelope", d => { d.paths["/projects"]!.get!.responses["401"] = {}; }],
    ["missing meta", d => { delete d.paths["/projects"]!.get!.responses["200"]!.content!["application/json"]!.schema.properties!.meta; }],
    ["required search", d => { d.paths["/projects/{projectId}/tasks"]!.get!.parameters!.find(p => p.name === "q")!.required = true; }],
    ["short search", d => { d.paths["/projects/{projectId}/tasks"]!.get!.parameters!.find(p => p.name === "q")!.schema.maxLength = 1; }],
    ["unknown query", d => { d.paths["/projects"]!.get!.parameters!.push({ name: "unknown", in: "query", required: true, schema: { type: "string" } }); }],
    ["wrong default", d => { d.paths["/projects"]!.get!.parameters!.find(p => p.name === "limit")!.schema.default = 10; }],
    ["wrong status", d => { delete d.paths["/projects"]!.get!.responses["404"]; }],
    ["wrong signature pattern", d => { d.paths["/attachments/{attachmentId}/content"]!.get!.parameters!.find(p => p.name === "signature")!.schema.pattern = ".*"; }],
  ];
  for (const [name, mutate] of mutations) it(`rejects ${name} through the same comparator`, () => {
    const document = load(); mutate(document); expect(() => compare(document)).toThrow();
  });
});
