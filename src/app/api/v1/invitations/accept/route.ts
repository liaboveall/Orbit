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
import { resolveClientIp } from "@/server/http/client-ip";
import { enforceAnonymousInviteLimit, enforceWriteLimit } from "@/server/http/write-limit";
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
 * 限流（docs/03 §8：「邀请预览/接受 20 次/IP/分钟」明确把 accept 与 preview 列在
 * 同一条 IP 限流规则里；A10 修复：此前只接入了共享用户写限流桶，遗漏了这条 IP 限流，
 * 一个用户可以换绑不同账号但共享同一 IP 反复接受邀请而不受 20/IP/分钟约束）。
 * 该端点因此同时受两条独立的桶约束，**两者都要满足**（docs/05、AGENTS.md 均未允许
 * 「任一满足即可」）：
 *  1. 按 IP 解析的匿名邀请桶（enforceAnonymousInviteLimit，与 preview 共享同一限流器
 *     实例与同一 20/分钟额度——两端点的桶是**共享**的，不是各自独立的 20 次，因为
 *     它们共同构成 docs/03 §8 里同一条「邀请预览/接受 20 次/IP/分钟」规则，按 IP
 *     合计计数，不按端点路径分别计数；见 write-limit.ts 顶部注释与
 *     tests/integration/rate-limit-invitations.test.ts 的显式验证）；
 *  2. 按用户解析的共享业务写桶（enforceWriteLimit，60/用户/分钟，与其它业务写操作
 *     共享同一限额，防止接受操作绕过整体写速率上限）。
 * 顺序：先查 IP 桶（未认证前即可判定，避免对未认证请求做不必要的会话解析），再查
 * 会话，再查用户写桶——任一先命中即以该结果的 429 返回，不继续往下执行。
 *
 * Next.js 16：无动态段。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /invitations/accept：已认证用户接受邀请。
 *
 * 顺序：Origin → IP 限流（与 preview 共享桶） → 会话 → 用户写限流 → 请求体形状 →
 * 领域服务。
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);
  try {
    const denied = verifyRequestOrigin(request, requestId);
    if (denied) return denied;

    // 与 preview 共享同一 IP 限流桶（docs/03 §8 的「邀请预览/接受 20 次/IP/分钟」是
    // 一条规则，不是两条独立的 20 次）。放在会话校验之前：未认证请求也应计入这个桶，
    // 否则匿名方可以先发大量未认证 accept（早于会话校验被拒）来试探/消耗配额边界，
    // 而不受这条 IP 限流约束——该请求仍然是一次真实的网络请求，理应计数。
    const forwardedFor = request.headers.get("x-forwarded-for");
    const clientIp = resolveClientIp(forwardedFor ?? undefined);
    const ipLimited = await enforceAnonymousInviteLimit(clientIp, requestId);
    if (ipLimited) return ipLimited;

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
