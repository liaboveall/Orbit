import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormFallback, AuthShell } from "@/features/auth/auth-shell";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";

/**
 * /auth/reset-password（M1 / ORB-005）。重置邮件链接落点：?token=…。
 * ResetPasswordForm 用 useSearchParams 读取 token，需 Suspense 边界。
 */
export const metadata: Metadata = { title: "重设密码" };

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="重设密码"
      description="为你的账号设置一个新密码（至少 12 个字符）。"
    >
      <Suspense fallback={<AuthFormFallback />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
