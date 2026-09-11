import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormFallback, AuthShell } from "@/features/auth/auth-shell";
import { VerifyStatus } from "@/features/auth/verify-status";

/**
 * /auth/verify（M1 / ORB-005）。验证邮件链接的 callbackURL 落点：
 * 库在验证成功/失败后重定向到此页（失败带 ?error=CODE），页面据会话与参数展示状态。
 * VerifyStatus 用 useSearchParams，需 Suspense 边界。
 */
export const metadata: Metadata = { title: "邮箱验证" };

export default function VerifyPage() {
  return (
    <AuthShell title="邮箱验证">
      <Suspense fallback={<AuthFormFallback />}>
        <VerifyStatus />
      </Suspense>
    </AuthShell>
  );
}
