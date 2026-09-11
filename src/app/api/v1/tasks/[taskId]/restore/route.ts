import { enforceWriteLimit } from "@/server/http/write-limit";
import { VersionInputSchema, parseRequestBody } from "@/contracts";
import { requireSessionUser } from "@/server/auth/session";
import { errorResponse, toErrorResponse } from "@/server/http/errors";
import {
  jsonEnvelope,
  jsonSuccess,
  readJsonBody,
  requireIdempotencyKey,
} from "@/server/http/json";
import { verifyRequestOrigin } from "@/server/http/origin";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { restoreTask } from "@/server/modules/task";

/**
 * `/api/v1/tasks/[taskId]/restore`（M2 / ORB-008）：POST 恢复软删除的任务。
 *
 * 契约：contracts/openapi.json `paths./tasks/{taskId}/restore`（operationId restoreTask）。
 *  - POST 200 → `{data: Task, meta}`；幂等重放 200 → 同原结果（docs/05 §5）。
 *  - 仅 owner 或任务创建者可恢复（其余成员 → 403 FORBIDDEN）；新恢复操作要求已删除态，已完成请求可幂等重放；
 *    expectedVersion 从**请求体** VersionInput 读取（不符 → 409 + currentVersion）；
 *    归档项目 → 409 PROJECT_ARCHIVED；恢复超配额 → 422 LIMIT_EXCEEDED。
 *
 * 请求生命周期（docs/03 §4）：请求 ID → Origin → 会话 → Idempotency-Key → schema 校验 →
 * 领域服务（锁 + 授权 + 版本比对 + 配额 + 幂等 + 活动）→ DTO → 统一信封。路由层只做 HTTP 编排。
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
 * POST /tasks/{taskId}/restore：恢复任务。
 *
 * 顺序：Origin → 会话 → Idempotency-Key（合法 UUID）→ 请求体形状 → 领域服务。
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const denied = verifyRequestOrigin(request, requestId);
    if (denied) return denied;

    const { taskId } = await context.params;
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

    const parsed = parseRequestBody(VersionInputSchema, raw.body, requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);

    // 恢复恒为 200（新建才用 201）；幂等重放亦为 200 原结果（docs/05 §2/§5）。
    const { task } = await restoreTask(taskId, sessionUser.id, parsed.data, idempotencyKey);
    return jsonSuccess(task, requestId);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
