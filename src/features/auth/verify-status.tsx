"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CircleAlert, CircleCheck, MailCheck } from "lucide-react";
import { InlineError } from "@/components/ui/inline-error";
import { Spinner, SubmitButton, TextField } from "./auth-form";
import { useResendVerification, useSession } from "./use-auth";
import { isValidEmail } from "./validation";

/**
 * 邮箱验证状态页（M1 / ORB-005，/auth/verify）。
 *
 * 验证邮件里的链接指向库内置 GET /api/auth/verify-email?token=…&callbackURL=/auth/verify：
 *  - 成功：库置 emailVerified、按 autoSignInAfterVerification 建会话，再重定向到本页（无 error 参数）→
 *    本页用 useSession 读到已登录已验证用户，展示「验证成功」并引导进入 /app/today。
 *  - 失败：库重定向到本页并带 ?error=CODE（TOKEN_EXPIRED / INVALID_TOKEN / USER_NOT_FOUND）→ 展示对应文案 + 重发。
 *  - 直接访问（无 token、无会话）：展示重发验证邮件表单——未验证用户被中间件限制在此页，可自助重发。
 */
export function VerifyStatus() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");
  const { data: session, isPending } = useSession();

  if (errorCode) {
    return <VerifyErrorState errorCode={errorCode} />;
  }
  if (isPending) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-foreground-secondary">
        <Spinner className="h-5 w-5" />
        <p className="text-label">正在确认验证状态…</p>
      </div>
    );
  }
  if (session?.user) {
    return <VerifySuccessState email={session.user.email} />;
  }
  return <ResendVerificationState />;
}

/** 验证成功：展示已验证邮箱并引导进入应用（整页跳转，确保服务端读到会话）。 */
function VerifySuccessState({ email }: { email: string }) {
  function goToApp(): void {
    // 认证态变更需整页跳转：httpOnly 会话 cookie 的变化对客户端路由不可见，
    // 硬跳转确保 proxy/服务端重新评估会话（router.push 可能命中过期缓存态）。
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/app/today");
  }
  return (
    <div className="space-y-4 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success">
        <CircleCheck className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="text-section font-semibold text-foreground">邮箱验证成功</h2>
      <p className="text-label leading-relaxed text-foreground-secondary">
        <span className="font-medium text-foreground">{email}</span> 已验证，并已为你登录。
      </p>
      <button
        type="button"
        onClick={goToApp}
        className="inline-flex h-11 w-full items-center justify-center rounded-control bg-brand text-label font-medium text-foreground-invert transition-colors duration-150 ease-standard hover:bg-brand-hover"
      >
        进入 Orbit
      </button>
    </div>
  );
}

/** 验证失败/过期：给出可读文案并提供重发入口。 */
function VerifyErrorState({ errorCode }: { errorCode: string }) {
  const message = describeVerifyError(errorCode);
  return (
    <div className="space-y-4">
      <div className="space-y-3 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
          <CircleAlert className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="text-section font-semibold text-foreground">
          {errorCode === "TOKEN_EXPIRED" ? "验证链接已过期" : "验证未成功"}
        </h2>
        <p className="text-label leading-relaxed text-foreground-secondary">{message}</p>
      </div>
      <ResendVerificationState compact />
    </div>
  );
}

function describeVerifyError(code: string): string {
  switch (code) {
    case "TOKEN_EXPIRED":
      return "这个验证链接已过期。请重新发送一封验证邮件，然后用新链接完成验证。";
    case "INVALID_TOKEN":
      return "这个验证链接无效或已被使用。请重新发送一封验证邮件。";
    case "USER_NOT_FOUND":
      return "找不到与该链接对应的账户。请确认邮箱后重新注册或重发验证邮件。";
    default:
      return "验证未能完成。请重新发送一封验证邮件后重试。";
  }
}

/** 重发验证邮件表单（输入邮箱 → POST /send-verification-email）。 */
function ResendVerificationState({ compact = false }: { compact?: boolean }) {
  const { resend, pending, error } = useResendVerification();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidEmail(email)) {
      setFieldError("请输入有效的邮箱地址。");
      return;
    }
    setFieldError(null);
    const ok = await resend(email.trim());
    if (ok) setSent(true);
  }

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        {!compact ? (
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
            <MailCheck className="h-6 w-6" aria-hidden="true" />
          </span>
        ) : null}
        <div className="space-y-1.5">
          <h2 className={compact ? "text-label font-semibold text-foreground" : "text-section font-semibold text-foreground"}>
            验证邮件已重新发送
          </h2>
          <p className="text-label leading-relaxed text-foreground-secondary">
            我们已向 <span className="font-medium text-foreground">{email}</span> 重新发送验证邮件。
            请点击邮件中的按钮完成验证；验证后会自动登录。
          </p>
        </div>
        <Link
          href="/auth/login"
          className="text-label text-brand underline-offset-4 hover:text-brand-hover hover:underline"
        >
          返回登录
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {!compact ? (
        <div className="space-y-3 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
            <MailCheck className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="text-section font-semibold text-foreground">验证你的邮箱</h2>
          <p className="text-label leading-relaxed text-foreground-secondary">
            注册后需要验证邮箱才能登录。输入你的邮箱，我们会（重新）发送验证邮件。
          </p>
        </div>
      ) : null}
      <TextField
        label="邮箱"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldError}
        disabled={pending}
        autoFocus
      />
      <InlineError>{error}</InlineError>
      <SubmitButton pending={pending} pendingText="发送中…">
        {compact ? "重新发送验证邮件" : "发送验证邮件"}
      </SubmitButton>
      <p className="text-center text-label text-foreground-secondary">
        <Link
          href="/auth/login"
          className="text-brand underline-offset-4 hover:text-brand-hover hover:underline"
        >
          返回登录
        </Link>
      </p>
    </form>
  );
}
