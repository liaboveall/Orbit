import { enforceWriteLimit } from "@/server/http/write-limit";
import { UpdateTaskSchema, VersionQuerySchema, parseQueryParams, parseRequestBody } from "@/contracts";
import { requireSessionUser } from "@/server/auth/session";
import { errorResponse, toErrorResponse } from "@/server/http/errors";
import { jsonEnvelope, jsonSuccess, readJsonBody } from "@/server/http/json";
import { verifyRequestOrigin } from "@/server/http/origin";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { getTask, softDeleteTask, updateTask } from "@/server/modules/task";

/**
 * `/api/v1/tasks/[taskId]`（M2 / ORB-008）：GET 读取任务，PATCH 更新任务，DELETE 软删除任务。
 *
 * 契约：contracts/openapi.json `paths./tasks/{taskId}`
 *  （operationId getTask / updateTask / deleteTask）。
 *  - GET 200 → `{data: Task, meta}`；非成员/不存在/已软删除 → 404 NOT_FOUND。
 *  - PATCH 200 → `{data: Task, meta}`；乐观并发（expectedVersion 不符 → 409 + currentVersion），
 *    成员可改（归档项目 → 409 PROJECT_ARCHIVED）。
 *  - DELETE 200 → `{data: DeletedTask, meta}`；expectedVersion 从**查询参数**读取（必填），
 *    仅 owner 或任务创建者可删（其余成员 → 403 FORBIDDEN）。
 *
 * 请求生命周期（docs/03 §4）：请求 ID → Origin（仅写操作）→ 会话 → schema 校验 →
 * 领域服务（锁 + 授权 + 版本比对 + 白名单写入 + 活动）→ DTO → 统一信封。路由层只做 HTTP 编排。
 *
 * Next.js 16：动态段 `params` 为 Promise，须 `await`。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 动态路由参数（Next.js 16 中为 Promise）。 */
interface RouteContext {
  params: Promise<{ taskId: string }>;
}

/**
 * DELETE 的查询参数 schema（openapi deleteTask：expectedVersion 为必填 integer ≥ 1）。
 * 查询参数只接受单个正十进制安全整数，与评论/子任务删除一致。
 */
const DeleteTaskQuerySchema = VersionQuerySchema;

/** GET /tasks/{taskId}：读取任务详情（成员可见；非成员/不存在/已软删除 → 404）。 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const { taskId } = await context.params;
    const sessionUser = await requireSessionUser(request);
    const task = await getTask(taskId, sessionUser.id);
    return jsonSuccess(task, requestId);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

/**
 * PATCH /tasks/{taskId}：更新任务字段（成员可改）。
 *
 * 顺序：Origin → 会话 → 请求体形状 → 领域服务（行锁 + 授权 + 版本比对 + 白名单写入 + 活动）。
 */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const denied = verifyRequestOrigin(request, requestId);
    if (denied) return denied;

    const { taskId } = await context.params;
    const sessionUser = await requireSessionUser(request);
    const limited = await enforceWriteLimit(sessionUser.id, requestId);
    if (limited) return limited;

    const raw = await readJsonBody(request);
    if (!raw.ok) {
      if (raw.tooLarge) {
        return errorResponse("PAYLOAD_TOO_LARGE", "请求体超过大小限制。", requestId);
      }
      return errorResponse("VALIDATION_ERROR", "请求体必须是合法的 JSON 对象。", requestId);
    }

    const parsed = parseRequestBody(UpdateTaskSchema, raw.body, requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);

    const updated = await updateTask(taskId, sessionUser.id, parsed.data);
    return jsonSuccess(updated, requestId);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

/**
 * DELETE /tasks/{taskId}：软删除任务（owner 或创建者）。
 *
 * 顺序：Origin → 会话 → 查询参数（expectedVersion 必填）→ 领域服务。
 */
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const denied = verifyRequestOrigin(request, requestId);
    if (denied) return denied;

    const { taskId } = await context.params;
    const sessionUser = await requireSessionUser(request);
    const limited = await enforceWriteLimit(sessionUser.id, requestId);
    if (limited) return limited;

    const values = new URL(request.url).searchParams.getAll("expectedVersion");
    const params = { expectedVersion: values.length === 1 ? values[0] : undefined };
    const parsed = parseQueryParams(DeleteTaskQuerySchema, params, requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);

    const deleted = await softDeleteTask(taskId, sessionUser.id, parsed.data.expectedVersion);
    return jsonSuccess(deleted, requestId);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
