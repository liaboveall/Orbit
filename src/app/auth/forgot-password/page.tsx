import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormFallback, AuthShell } from "@/features/auth/auth-shell";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";

/**
 * /auth/forgot-password（M1 / ORB-005）。找回失败/成功文案不泄露账户是否存在。
 */
export const metadata: Metadata = { title: "找回密码" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="找回密码"
      description="输入注册邮箱，我们会发送一封密码重置邮件。"
    >
      <Suspense fallback={<AuthFormFallback />}>
        <ForgotPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
