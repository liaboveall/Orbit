import { enforceWriteLimit } from "@/server/http/write-limit";
import { parseRequestBody } from "@/contracts";
import { MoveTaskSchema } from "@/contracts";
import { requireSessionUser } from "@/server/auth/session";
import { errorResponse, toErrorResponse } from "@/server/http/errors";
import { jsonEnvelope, jsonSuccess, readJsonBody } from "@/server/http/json";
import { verifyRequestOrigin } from "@/server/http/origin";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { moveTask } from "@/server/modules/task/move";

/**
 * `/api/v1/tasks/[taskId]/move`（M3 Phase 3 / ORB-011）：POST 移动任务。
 *
 * 契约真源：contracts/openapi.json paths./tasks/{taskId}/move (operationId: moveTask)
 * - body: `{ expectedVersion, expectedBoardVersion, toStatus, beforeTaskId }`（4 字段全必填）
 * - response: `{ data: { task: TaskDTO, boardVersion }, meta }`（绝不含 position）
 * - 成功 200，冲突 409 VERSION_CONFLICT/BOARD_CONFLICT（含 currentVersion/currentBoardVersion）
 * - 超限 429 **RATE_LIMITED**（带 Retry-After header）
 *
 * 请求生命周期（docs/03 §4）：请求 ID → Origin（写操作必需）→ 会话 → schema 校验 → 领域服务
 *   （锁 + 授权 + 版本比对 + 白名单写入 + 活动）→ DTO → 统一信封。路由层只做 HTTP 编排。
 *
 * Next.js 16：动态段 `params` 为 Promise，须 `await`。
 */

/** Rate limiter singleton（内存实现，单实例部署用）。 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

/**
 * POST /tasks/{taskId}/move：移动任务。
 *
 * 顺序：Origin → 会话 → 限流 → 请求体形状 → 领域服务（行锁 + 授权 + 版本比对 + 白名单写入 + 活动）。
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);

  try {
    // 1. Origin 检查（写操作必需）
    const denied = verifyRequestOrigin(request, requestId);
    if (denied) return denied;

    // 2. 会话校验（限流需要 userId）
    const sessionUser = await requireSessionUser(request);
    const limited = await enforceWriteLimit(sessionUser.id, requestId);
    if (limited) return limited;

    const { taskId } = await context.params;

    // 4. 读取并校验请求体
    const raw = await readJsonBody(request);
    if (!raw.ok) {
      if (raw.tooLarge) {
        return errorResponse("PAYLOAD_TOO_LARGE", "请求体超过大小限制。", requestId);
      }
      return errorResponse("VALIDATION_ERROR", "请求体必须是合法的 JSON 对象。", requestId);
    }

    const parsed = parseRequestBody(MoveTaskSchema, raw.body, requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);

    // 5. Q10: UUID 规范化：确保 taskId 小写后与 idempotency key 匹配
    const normalizedTaskId = taskId.toLowerCase();
    
    // 5. 领域服务：执行移动
    const result = await moveTask(normalizedTaskId, sessionUser.id, parsed.data);

    // 6. 返回标准成功信封
    return jsonSuccess(result, requestId);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
