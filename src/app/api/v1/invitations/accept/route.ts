import { InviteTokenSchema, parseRequestBody } from "@/contracts";
import { requireSessionUser } from "@/server/auth/session";
import { errorResponse, toErrorResponse } from "@/server/http/errors";
import {
  jsonEnvelope,
  jsonSuccess,
  readJsonBody,
} from "@/server/http/json";
import { verifyRequestOrigin } from "@/server/http/origin";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { enforceWriteLimit } from "@/server/http/write-limit";
import { acceptInvitation } from "@/server/modules/invitation/service";

/**
 * `/api/v1/invitations/accept`（M4 / ORB-013）：POST 接受邀请。
 *
 * 契约：contracts/openapi.json `paths./invitations/accept`
 *  （operationId acceptInvitation，security:[sessionCookie]）。
 *  - 请求体：InviteToken `{token: string}`（明文令牌）。
 *  - 200 → `{data: AcceptedInvitation, meta:{requestId}}`。
 *  - 未认证 → 401；令牌已使用 → 409；已过期/已撤销 → 410。
 *
 * 请求生命周期（docs/03 §4）：请求 ID → Origin → 会话 → 限流 → schema 校验 →
 * 领域服务（状态检查 + 成员创建 + 活动）→ DTO → 统一信封。
 *
 * 限流（A07 审查修复）：已认证端点接入共享用户写限流桶（enforceWriteLimit），
 * 防止接受操作绕过与其它业务写操作共同的速率限额反复抢邀请锁。
 *
 * Next.js 16：无动态段。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /invitations/accept：已认证用户接受邀请。
 *
 * 顺序：Origin → 会话 → 限流 → 请求体形状 → 领域服务。
 */
export async function POST(request: Request): Promise<Response> {
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
        return errorResponse("PAYLOAD_TOO_LARGE", "请求体超过大小限制。", requestId);
      }
      return errorResponse("VALIDATION_ERROR", "请求体必须是合法的 JSON 对象。", requestId);
    }

    const parsed = parseRequestBody(InviteTokenSchema, raw.body, requestId);
    if (!parsed.ok) return jsonEnvelope(parsed.response, 400, requestId);

    const result = await acceptInvitation(parsed.data.token, sessionUser.id);
    return jsonSuccess(result, requestId);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
