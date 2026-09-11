import { InviteTokenSchema, parseRequestBody } from "@/contracts";
import { toErrorResponse } from "@/server/http/errors";
import {
  jsonEnvelope,
  jsonSuccess,
  readJsonBody,
} from "@/server/http/json";
import { errorResponse } from "@/server/http/errors";
import { enforceAnonymousInviteLimit } from "@/server/http/write-limit";
import { resolveClientIp } from "@/server/http/client-ip";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { previewInvitation } from "@/server/modules/invitation/service";

/**
 * `/api/v1/invitations/preview`（M4 / ORB-013）：POST 匿名预览邀请信息。
 *
 * 契约：contracts/openapi.json `paths./invitations/preview`
 *  （operationId previewInvitation，security:[]）。
 *  - 请求体：InviteToken `{token: string}`（明文令牌）。
 *  - 200 → `{data: InvitePreview, meta:{requestId}}`。
 *  - 令牌不存在 → 404；已使用 → 409；已过期/已撤销 → 410。
 *
 * 安全：该端点**不要求认证**（proxy.ts 已排除）；不泄露项目敏感信息，
 * 仅返回 projectName/ownerName/expiresAt/role/isArchived。
 * 不检查 Origin（安全方法之外的匿名端点由自身无副作用保证安全）。
 *
 * 限流（docs/03 §8：匿名端点按可信代理边界解析的客户端 IP，20 次/分钟，A07 审查修复）：
 * 该端点无会话可用于按用户限流，必须独立按 IP 限流，防止匿名扫描/枚举令牌。
 *
 * Next.js 16：无动态段。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /invitations/preview：匿名预览邀请最小信息。 */
export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const clientIp = resolveClientIp(request);
    const limited = await enforceAnonymousInviteLimit(clientIp, requestId);
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

    const preview = await previewInvitation(parsed.data.token);
    return jsonSuccess(preview, requestId);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
