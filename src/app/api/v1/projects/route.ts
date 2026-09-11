import { enforceWriteLimit } from "@/server/http/write-limit";
import {
  CreateProjectSchema,
  ProjectListQuerySchema,
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
import { createProject, listProjects } from "@/server/modules/project";

/**
 * `/api/v1/projects`（M2 / ORB-007）：GET 列出我的项目，POST 创建项目。
 *
 * 契约：contracts/openapi.json `paths./projects`（operationId listProjects / createProject）。
 *  - GET 200 → `{data: Project[], meta: PageMeta}`（游标分页）。
 *  - POST 201 → `{data: Project, meta}`；幂等重放 200 → 同原结果（docs/05 §5）。
 *
 * 请求生命周期（docs/03 §4）：请求 ID → Origin（仅写操作）→ 会话 → schema 校验 →
 * 领域服务（配额/唯一性/幂等/授权）→ DTO → 统一信封。路由层只做 HTTP 编排。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /projects：列出当前用户拥有/参与的项目（scope + archived + 游标分页）。 */
export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const sessionUser = await requireSessionUser(request);

    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const parsed = parseQueryParams(ProjectListQuerySchema, params, requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);

    const result = await listProjects(sessionUser.id, parsed.data);
    return jsonList(
      result.projects,
      { requestId, nextCursor: result.nextCursor, hasMore: result.hasMore },
      requestId,
    );
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

/**
 * POST /projects：创建项目（owner = 当前会话用户）。
 *
 * 顺序：Origin → 会话 → Idempotency-Key（合法 UUID）→ 请求体形状 → 领域服务。
 * 领域服务在用户级事务锁内校验配额、key 唯一性、幂等，并写活动与幂等记录。
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const denied = verifyRequestOrigin(request, requestId);
    if (denied) return denied;

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

    const parsed = parseRequestBody(CreateProjectSchema, raw.body, requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);

    const { project, replayed } = await createProject(
      sessionUser.id,
      parsed.data,
      idempotencyKey,
    );
    // 201 新建成功；200 幂等重放（docs/05 §2/§5）。
    return replayed ? jsonSuccess(project, requestId) : jsonCreated(project, requestId);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
