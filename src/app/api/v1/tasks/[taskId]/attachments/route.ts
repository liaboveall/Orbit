import { enforceWriteLimit } from "@/server/http/write-limit";
import { logEvent } from "@/server/http/log";
import { toErrorResponse } from "@/server/http/errors";
import { jsonSuccess } from "@/server/http/json";
import { verifyRequestOrigin } from "@/server/http/origin";
import { resolveRequestIdFromRequest } from "@/server/http/request-id";
import { requireSessionUser } from "@/server/auth/session";
import { listAttachments } from "@/server/modules/attachments/service";
import { uploadMultipart } from "@/server/modules/attachments/multipart";
import { acquireUploadSlot } from "@/server/modules/attachments/upload-gate";
export const runtime="nodejs";
export const dynamic="force-dynamic";
interface Context {params:Promise<{taskId:string}>}
export async function GET(request:Request,context:Context) {
  const requestId=resolveRequestIdFromRequest(request);
  try {const user=await requireSessionUser(request);return jsonSuccess(await listAttachments((await context.params).taskId,user.id),requestId);}
  catch(error){return toErrorResponse(error,requestId);}
}
export async function POST(request:Request,context:Context) {
  const requestId=resolveRequestIdFromRequest(request);
  try {
    const denied=verifyRequestOrigin(request,requestId);if(denied)return denied;
    const user=await requireSessionUser(request);
    const limited=await enforceWriteLimit(user.id,requestId);if(limited)return limited;
    const slot = await acquireUploadSlot(user.id, requestId);
    if (!slot.allowed) return slot.response;
    try {
      const result=await uploadMultipart(request,(await context.params).taskId,user.id);
      return jsonSuccess(result.attachment,requestId,result.replayed?200:201);
    } finally {
      // F04 修复：租约释放失败不再覆盖业务结果（成功 201 与业务错误都要保留）。
      // PostgreSQL 租约 3 分钟到期自动回收（postgres-gate），此处只做脱敏留痕。
      try { await slot.release(); }
      catch { logEvent("warn", { event: "upload_lease_release_failed", requestId }); }
    }
  }catch(error){return toErrorResponse(error,requestId);}
}

