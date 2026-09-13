"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { InlineError } from "@/components/ui/inline-error";
import { sanitizeReturnTo } from "@/lib/return-to";
import { PasswordField, SubmitButton, TextField } from "./auth-form";
import { useSignIn } from "./use-auth";
import { isValidEmail } from "./validation";

/**
 * 登录表单（M1 / ORB-005，/auth/login）。
 *
 * - returnTo：从 URL 查询参数读取，登录成功后经 sanitizeReturnTo 严格校验（只允许同源相对路径），
 *   非法则回退 /app/today；用 window.location.assign 做整页跳转，确保服务端/中间件读到新会话 cookie。
 * - 失败文案：统一「邮箱或密码不正确」，不泄露账户是否存在（见 use-auth.describeSignInError）；
 *   未验证邮箱（403）单独提示并引导验证——服务端在校验密码通过后才判定，故不构成存在性泄露。
 * - 客户端即时校验邮箱格式与密码非空；服务端仍是权威。
 */
export function LoginForm() {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const { signIn, pending, error, needsVerification } = useSignIn();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: { email?: string; password?: string } = {};
    if (!isValidEmail(email)) nextErrors.email = "请输入有效的邮箱地址。";
    if (password.length === 0) nextErrors.password = "请输入密码。";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    // Clear previous errors on new submission
    setFieldErrors({});
    
    const ok = await signIn(email.trim(), password);
    if (ok) {
      // 整页跳转到经校验的同源路径（防开放重定向）。
      window.location.assign(sanitizeReturnTo(returnTo));
    }
    // Error is already set by useSignIn hook
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <TextField
        label="邮箱"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldErrors.email}
        disabled={pending}
        autoFocus
      />
      <PasswordField
        label="密码"
        name="password"
        autoComplete="current-password"
        placeholder="输入你的密码"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fieldErrors.password}
        disabled={pending}
      />

      <div className="flex justify-end">
        <Link
          href="/auth/forgot-password"
          className="text-label text-brand underline-offset-4 transition-colors duration-150 ease-standard hover:text-brand-hover hover:underline"
        >
          忘记密码？
        </Link>
      </div>

      {/* Error from server/API credential validation or other issues */}
      {error && <InlineError role="alert">{error}</InlineError>}

      {needsVerification ? (
        <p className="rounded-control bg-brand-soft px-3 py-2 text-label text-brand">
          完成邮箱验证后即可登录。验证邮件已发送到你的邮箱，也可前往
          <Link href="/auth/verify" className="mx-1 underline underline-offset-4">
            验证页
          </Link>
          查看状态或重新发送。
        </p>
      ) : null}

      <SubmitButton 
        pending={pending} 
        disabled={pending}
        pendingText="登录中…"
      >
        {pending ? "登录中…" : "登录"}
      </SubmitButton>

      <p className="text-center text-label text-foreground-secondary">
        还没有账号？
        <Link
          href="/auth/register"
          className="ml-1 text-brand underline-offset-4 transition-colors duration-150 ease-standard hover:text-brand-hover hover:underline"
        >
          注册
        </Link>
      </p>
    </form>
  );
}
