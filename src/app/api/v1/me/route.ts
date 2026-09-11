import { enforceWriteLimit } from "@/server/http/write-limit";
import { UpdateMeSchema, parseRequestBody } from "@/contracts";
import { requireSessionUser } from "@/server/auth/session";
import { errorResponse, toErrorResponse } from "@/server/http/errors";
import { jsonEnvelope, jsonSuccess, readJsonBody } from "@/server/http/json";
import { verifyRequestOrigin } from "@/server/http/origin";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { readUserById } from "@/server/me/read-user";
import { updateCurrentUser } from "@/server/me/update-user";

/**
 * GET / PATCH `/api/v1/me`（M1 / ORB-006）。
 *
 * 契约：contracts/openapi.json `paths./me`（operationId getMe / updateMe）——
 * 200 响应为 `{data: User, meta:{requestId}}`，请求体为 UpdateMe
 * （additionalProperties:false、minProperties:1、name 1—40、timezone 1—100）。
 *
 * 请求生命周期（docs/03 §4）：请求 ID → Origin（仅写操作）→ 会话检查 →
 * schema 校验 → 领域服务（业务不变量 + 授权）→ DTO → 统一信封。
 *
 * 缓存与隐私（验收标准 #3）：/me 是账户私有数据，所有响应（成功与错误）都带
 * `Cache-Control: private, no-store`，禁止浏览器/共享缓存留存，退出或换账号后
 * 不会读到上一账户的副本；错误响应该头由 HTTP 层 `toErrorResponse` 统一添加。
 *
 * 说明：本文件是路由层，只做 HTTP 编排；领域规则（IANA 时区校验、姓名归一化、
 * 白名单写入）在 `src/server/me/*`。信封构造与请求体读取复用 `src/server/http/json`
 * 的共享辅助（jsonSuccess / readJsonBody / jsonEnvelope），与其他 /api/v1 路由一致。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /me：返回当前账户档案。
 *
 * 未认证 → requireSessionUser 抛 401 UNAUTHENTICATED（统一信封）。
 * 已认证 → **直接查库**取最新行（不经 Better Auth 会话快照），保证 PATCH 后立即可读。
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const sessionUser = await requireSessionUser(request);
    const user = await readUserById(sessionUser.id);
    return jsonSuccess(user, requestId);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

/**
 * PATCH /me：修改姓名 / 时区（V1 仅此两项，docs/01 §3）。
 *
 * 顺序：Origin（自有变更 API 仅接受同源浏览器请求）→ 会话 → 请求体形状 →
 * 领域服务（IANA 时区、姓名归一化、白名单写库）→ 200 + 更新后的 User。
 * 非法时区 → 400 VALIDATION_ERROR + `fieldErrors.timezone`，且不落库。
 */
export async function PATCH(request: Request): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const denied = verifyRequestOrigin(request, requestId);
    if (denied) return denied;

    const sessionUser = await requireSessionUser(request);
    const limited = await enforceWriteLimit(sessionUser.id, requestId);
    if (limited) return limited;

    const raw = await readJsonBody(request);
    if (!raw.ok) {
      if (raw.tooLarge) {
        return errorResponse(
          "PAYLOAD_TOO_LARGE",
          "请求体超过大小限制。",
          requestId,
        );
      }
      return errorResponse(
        "VALIDATION_ERROR",
        "请求体必须是合法的 JSON 对象。",
        requestId,
      );
    }

    const parsed = parseRequestBody(UpdateMeSchema, raw.body, requestId);
    if (!parsed.ok) {
      return jsonEnvelope(parsed.response, 400, requestId);
    }

    const updated = await updateCurrentUser(sessionUser.id, parsed.data);
    return jsonSuccess(updated, requestId);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
