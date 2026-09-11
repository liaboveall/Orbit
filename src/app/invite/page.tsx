import type { Metadata } from "next";
import { AuthShell } from "@/features/auth/auth-shell";
import { InviteAccept } from "@/features/invitations/InviteAccept";

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
 * 匿名可访问：getSessionUser 仅用于判定登录态，不做重定向；令牌校验在服务端权威完成。
 */

export const metadata: Metadata = {
  title: "接受邀请 · Orbit",
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default function InvitePage() {
  // Client-side token extraction via InviteAccept component

  return (
    <AuthShell>
      {/* No initial token passed server-side - client will extract from hash */}
      <InviteAccept
        token={null}
        isLoggedIn={false}
        returnPath="/invite"
      />
    </AuthShell>
  );
}
