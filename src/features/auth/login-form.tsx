"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { InlineError } from "@/components/ui/inline-error";
import { sanitizeReturnTo } from "@/lib/return-to";
import { PasswordField, SubmitButton, TextField, textLink } from "./auth-form";
import { useSignIn } from "./use-auth";
import { isValidEmail } from "./validation";

/**
 * 登录表单（/auth/login）。
 *
 * - returnTo 从查询参数读取，登录成功后经 sanitizeReturnTo 校验（只允许同源相对路径），
 *   不合法则回到 /app/today；用整页跳转，让服务端读到新的会话 cookie。
 * - 失败文案统一为「邮箱或密码不正确」，不泄露账户是否存在。未验证邮箱单独提示：
 *   服务端在密码正确后才返回这个状态，所以不构成存在性泄露。
 * - 客户端即时校验邮箱格式和密码非空，服务端仍是权威。
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

    const ok = await signIn(email.trim(), password);
    // 整页跳转到经校验的同源路径（防开放重定向）。失败时错误由 useSignIn 给出。
    if (ok) window.location.assign(sanitizeReturnTo(returnTo));
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
      <div className="space-y-2">
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
        <p className="text-right text-label">
          <Link href="/auth/forgot-password" className={textLink}>
            忘记密码？
          </Link>
        </p>
      </div>

      {error && <InlineError role="alert">{error}</InlineError>}

      {needsVerification ? (
        <p className="rounded-control bg-brand-soft px-3 py-2.5 text-label leading-relaxed text-brand-ink">
          完成邮箱验证后即可登录。验证邮件已发送到你的邮箱，也可前往
          <Link href="/auth/verify" className="mx-1 rounded-[6px] font-medium underline underline-offset-4 outline-none">
            验证页
          </Link>
          查看状态或重新发送。
        </p>
      ) : null}

      <SubmitButton pending={pending} pendingText="登录中…">
        登录
      </SubmitButton>

      <p className="text-center text-label text-foreground-secondary">
        还没有账号？
        <Link href="/auth/register" className={`ml-1 ${textLink}`}>
          注册
        </Link>
      </p>
    </form>
  );
}
