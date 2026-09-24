import { z } from "zod";

/**
 * 待接受邀请令牌的标签页内暂存（R02 hash 协议的配套）。
 *
 * 令牌从 `#token=` 读出后暂存在 sessionStorage，支持「先登录/换账号再回到 /invite 接受」。
 * 暂存最多 30 分钟：超时、终态失效或接受成功后删除，避免共享电脑上下一位使用者在同一
 * 标签页里拾到上一位未处理的邀请。仍只存在当前标签页，不写 URL、cookie 或 localStorage。
 */

const KEY = "inviteToken";
export const PENDING_INVITE_TTL_MS = 30 * 60 * 1000;

const PendingInviteSchema = z.object({
  token: z.string().min(1),
  savedAt: z.number().int().positive(),
});

export function rememberInviteToken(token: string, now = Date.now()): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ token, savedAt: now }));
  } catch {
    /* Storage unavailable: the in-memory token still works for this page. */
  }
}

export function forgetInviteToken(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* Storage unavailable. */
  }
}

export function recallInviteToken(now = Date.now()): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed = PendingInviteSchema.safeParse(JSON.parse(raw));
    if (parsed.success && parsed.data.savedAt <= now && now - parsed.data.savedAt <= PENDING_INVITE_TTL_MS)
      return parsed.data.token;
  } catch {
    /* Invalid or unavailable storage. */
  }
  forgetInviteToken();
  return null;
}
