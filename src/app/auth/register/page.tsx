import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { sanitizeReturnTo } from "@/lib/return-to";
import { AuthFormFallback, AuthShell } from "@/features/auth/auth-shell";
import { RegisterForm } from "@/features/auth/register-form";

/**
 * /auth/register（M1 / ORB-005）。注册后需邮箱验证方可登录（requireEmailVerification）。
 */
export const metadata: Metadata = { title: "注册" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams?: Promise<{ returnTo?: string | string[] }>;
} = {}) {
  if (await getSessionUser(await headers())) {
    const params = searchParams ? await searchParams : undefined;
    const rawReturnTo = Array.isArray(params?.returnTo) ? params.returnTo[0] : params?.returnTo;
    redirect(sanitizeReturnTo(rawReturnTo));
  }
  return (
    <AuthShell
      title="创建 Orbit 账号"
      description="注册后我们会发送一封验证邮件，验证通过即可登录。"
    >
      <Suspense fallback={<AuthFormFallback />}>
        <RegisterForm />
      </Suspense>
    </AuthShell>
  );
}
