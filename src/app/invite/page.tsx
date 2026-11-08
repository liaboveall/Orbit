import type { Metadata } from "next";
import { headers } from "next/headers";
import { AuthShell } from "@/features/auth/auth-shell";
import { InviteAccept } from "@/features/invitations/InviteAccept";
import { UserTimezoneProvider } from "@/lib/user-timezone";
import { getSessionUser } from "@/server/auth/session";

/**
 * /invite —— 邀请预览与接受 (M4 / ORB-013，公开页，哈希片段协议).
 *
 * 安全修复 (R02): 从路径段/query 参数切换到哈希片段 #token=<hash>,防止:
 * - HTTP 日志记录 URL → Referer header 泄露
 * - Browser history 中明文 URL
 *
 * Server Component 仅做会话检查与外壳渲染。Token 提取由 Client Component 
 * InviteAccept 负责，从 window.location.hash 解析并存储到 sessionStorage。
 *
 * 匿名可访问：getSessionUser 仅用于判定登录态与注入账户时区，不做重定向；令牌校验在服务端权威完成。
 */

export const metadata: Metadata = {
  title: "接受邀请 · Orbit",
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default async function InvitePage() {
  const sessionUser = await getSessionUser(await headers());

  return (
    <UserTimezoneProvider value={sessionUser?.timezone ?? null}>
      <AuthShell>
        {/* No initial token passed server-side - client will extract from hash */}
        <InviteAccept
          token={null}
          isLoggedIn={sessionUser !== null}
          returnPath="/invite"
        />
      </AuthShell>
    </UserTimezoneProvider>
  );
}
