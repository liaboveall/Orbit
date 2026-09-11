import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { DEFAULT_RETURN_TO } from "@/lib/return-to";
import { AuthFormFallback, AuthShell } from "@/features/auth/auth-shell";
import { LoginForm } from "@/features/auth/login-form";

/**
 * /auth/login（M1 / ORB-005）。登录表单是客户端组件（读 returnTo、调用 signIn），
 * 用 Suspense 包裹以满足 useSearchParams 的边界要求。
 */
export const metadata: Metadata = { title: "登录" };

export default async function LoginPage() {
  if (await getSessionUser(await headers())) redirect(DEFAULT_RETURN_TO);
  return (
    <AuthShell
      title="登录 Orbit"
      description="欢迎回来。用你的邮箱和密码登录。"
    >
      <Suspense fallback={<AuthFormFallback />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
