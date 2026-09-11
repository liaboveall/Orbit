import { enforceWriteLimit } from "@/server/http/write-limit";
import {
  CreateTaskSchema,
  TaskListQuerySchema,
  parseQueryParams,
  parseRequestBody,
} from "@/contracts";
import { requireSessionUser } from "@/server/auth/session";
import { errorResponse, toErrorResponse } from "@/server/http/errors";
import {
  jsonCreated,
  jsonEnvelope,
  jsonList,
  jsonSuccess,
  readJsonBody,
  requireIdempotencyKey,
} from "@/server/http/json";
import { verifyRequestOrigin } from "@/server/http/origin";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { createTask, listProjectTasks } from "@/server/modules/task";

/**
 * `/api/v1/projects/[projectId]/tasks`（M2 / ORB-008）：GET 列出项目任务，POST 创建任务。
 *
 * 契约：contracts/openapi.json `paths./projects/{projectId}/tasks`
 *  （operationId listProjectTasks / createTask）。
 *  - GET 200 → `{data: TaskSummary[], meta: PageMeta}`（游标分页 + 过滤 + 排序）。
 *  - POST 201 → `{data: Task, meta}`；幂等重放 200 → 同原结果（docs/05 §5）。
 *
 * 请求生命周期（docs/03 §4）：请求 ID → Origin（仅写操作）→ 会话 → schema 校验 →
 * 领域服务（成员/归档/配额/编号/幂等/授权）→ DTO → 统一信封。路由层只做 HTTP 编排。
 *
 * Next.js 16：动态段 `params` 为 Promise，须 `await`。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 动态路由参数（Next.js 16 中为 Promise）。 */
interface RouteContext {
  params: Promise<{ projectId: string }>;
}

/** GET /projects/{projectId}/tasks：列出项目任务（成员可见；非成员/不存在 → 404）。 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const { projectId } = await context.params;
    const sessionUser = await requireSessionUser(request);

    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const parsed = parseQueryParams(TaskListQuerySchema, params, requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);

    const result = await listProjectTasks(projectId, sessionUser.id, parsed.data);
    return jsonList(
      result.tasks,
      { requestId, nextCursor: result.nextCursor, hasMore: result.hasMore },
      requestId,
    );
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

/**
 * POST /projects/{projectId}/tasks：创建任务（creator = 当前会话用户）。
 *
 * 顺序：Origin → 会话 → Idempotency-Key（合法 UUID）→ 请求体形状 → 领域服务。
 * 领域服务在项目行锁事务内校验成员/归档、配额、负责人归属、取号与幂等，并写活动。
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const denied = verifyRequestOrigin(request, requestId);
    if (denied) return denied;

    const { projectId } = await context.params;
    const sessionUser = await requireSessionUser(request);
    const limited = await enforceWriteLimit(sessionUser.id, requestId);
    if (limited) return limited;
    const idempotencyKey = requireIdempotencyKey(request.headers);

    const raw = await readJsonBody(request);
    if (!raw.ok) {
      if (raw.tooLarge) {
        return errorResponse("PAYLOAD_TOO_LARGE", "请求体超过大小限制。", requestId);
      }
      return errorResponse("VALIDATION_ERROR", "请求体必须是合法的 JSON 对象。", requestId);
    }

    const parsed = parseRequestBody(CreateTaskSchema, raw.body, requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);

    const { task, replayed } = await createTask(
      projectId,
      sessionUser.id,
      parsed.data,
      idempotencyKey,
    );
    // 201 新建成功；200 幂等重放（docs/05 §2/§5）。
    return replayed ? jsonSuccess(task, requestId) : jsonCreated(task, requestId);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
