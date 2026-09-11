import { toErrorResponse } from "@/server/http/errors";
import { noContent } from "@/server/http/json";
import { enforceWriteLimit } from "@/server/http/write-limit";
import { verifyRequestOrigin } from "@/server/http/origin";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { requireSessionUser } from "@/server/auth/session";
import { deleteAttachment as deleteAttachmentService } from "@/server/modules/attachments/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ attachmentId: string }>;
}

/** DELETE /attachments/{attachmentId}：软删除附件 */
export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const requestId = resolveRequestIdFromRequest(request);

  try {
    // 1. Origin 检查
    const denied = verifyRequestOrigin(request, requestId);
    if (denied) return denied;

    // 2. 会话校验
    const sessionUser = await requireSessionUser(request);
    const limited = await enforceWriteLimit(sessionUser.id, requestId);
    if (limited) return limited;

    // 3. 获取 attachmentId
    const { attachmentId } = await context.params;

    // 4. 调用服务层
    await deleteAttachmentService(attachmentId, sessionUser.id);

    return noContent(requestId);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
