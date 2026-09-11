import { enforceWriteLimit } from "@/server/http/write-limit";
import { UpdateProjectSchema, parseRequestBody } from "@/contracts";
import { requireSessionUser } from "@/server/auth/session";
import { errorResponse, toErrorResponse } from "@/server/http/errors";
import {
  jsonEnvelope,
  jsonSuccess,
  readJsonBody,
} from "@/server/http/json";
import { verifyRequestOrigin } from "@/server/http/origin";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { getProject, updateProject } from "@/server/modules/project";

/**
 * `/api/v1/projects/[projectId]`（M2 / ORB-007）：GET 读取单个项目，PATCH 更新/归档/恢复。
 *
 * 契约：contracts/openapi.json `paths./projects/{projectId}`（operationId getProject / updateProject）。
 *  - GET 200 → `{data: Project, meta:{requestId}}`；非成员/不存在 → 404 NOT_FOUND。
 *  - PATCH 200 → `{data: Project, meta}`；owner-only（成员 → 403 FORBIDDEN），
 *    乐观并发（expectedVersion 不符 → 409 VERSION_CONFLICT + currentVersion），
 *    归档只读（除 owner restore → 409 PROJECT_ARCHIVED）。
 *
 * 请求生命周期（docs/03 §4）：请求 ID → Origin（仅写操作）→ 会话 → schema 校验 →
 * 领域服务（锁 + 授权 + 不变量）→ DTO → 统一信封。路由层只做 HTTP 编排。
 *
 * Next.js 16：动态段 `params` 为 Promise，须 `await`。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 动态路由参数（Next.js 16 中为 Promise）。 */
interface RouteContext {
  params: Promise<{ projectId: string }>;
}

/** GET /projects/{projectId}：读取项目（成员可见；非成员/不存在 → 404）。 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const { projectId } = await context.params;
    const sessionUser = await requireSessionUser(request);
    const project = await getProject(projectId, sessionUser.id);
    return jsonSuccess(project, requestId);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

/**
 * PATCH /projects/{projectId}：更新项目资料 / 归档 / 恢复（owner-only）。
 *
 * 顺序：Origin → 会话 → 请求体形状 → 领域服务（行锁 + 授权 + 版本比对 + 白名单写入 + 活动）。
 */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const denied = verifyRequestOrigin(request, requestId);
    if (denied) return denied;

    const { projectId } = await context.params;
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

    const parsed = parseRequestBody(UpdateProjectSchema, raw.body, requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);

    const updated = await updateProject(projectId, sessionUser.id, parsed.data);
    return jsonSuccess(updated, requestId);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
