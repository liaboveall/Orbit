"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CircleAlert, CircleCheck, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/inline-error";
import { Spinner } from "@/components/ui/spinner";
import { AuthNotice, SubmitButton, TextField, textLink } from "./auth-form";
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

/** 验证成功：显示已验证的邮箱并引导进入应用。 */
function VerifySuccessState({ email }: { email: string }) {
  function goToApp(): void {
    // 会话 cookie 是 httpOnly 的，客户端路由看不到它的变化；整页跳转让服务端重新判断会话。
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/app/today");
  }
  return (
    <AuthNotice
      tone="success"
      icon={<CircleCheck />}
      title="邮箱验证成功"
      actions={
        <Button size="lg" className="w-full" onClick={goToApp}>
          进入 Orbit
        </Button>
      }
    >
      <p>
        <span className="font-medium text-foreground [overflow-wrap:anywhere]">{email}</span> 已验证，并已为你登录。
      </p>
    </AuthNotice>
  );
}

/** 验证失败或过期：说明原因，并提供重新发送。 */
function VerifyErrorState({ errorCode }: { errorCode: string }) {
  return (
    <div className="space-y-6">
      <AuthNotice
        tone="danger"
        icon={<CircleAlert />}
        title={errorCode === "TOKEN_EXPIRED" ? "验证链接已过期" : "验证未成功"}
      >
        <p>{describeVerifyError(errorCode)}</p>
      </AuthNotice>
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

/** 重新发送验证邮件。compact 时只有表单，标题由上方的错误说明提供。 */
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
    const message = (
      <p>
        我们已向 <span className="font-medium text-foreground [overflow-wrap:anywhere]">{email}</span> 重新发送验证邮件。
        点击邮件中的按钮完成验证，验证后会自动登录。
      </p>
    );
    const back = (
      <Link href="/auth/login" className={textLink}>
        返回登录
      </Link>
    );
    if (compact) {
      return (
        <div role="status" className="space-y-3 rounded-tile bg-success-soft px-4 py-3.5 text-center text-label leading-relaxed text-foreground-secondary">
          <p className="font-semibold text-success">验证邮件已重新发送</p>
          {message}
          {back}
        </div>
      );
    }
    return (
      <AuthNotice tone="success" icon={<MailCheck />} title="验证邮件已重新发送" actions={back}>
        {message}
      </AuthNotice>
    );
  }

  return (
    <div className="space-y-6">
      {!compact ? (
        <AuthNotice icon={<MailCheck />} title="验证你的邮箱">
          <p>注册后需要验证邮箱才能登录。输入你的邮箱，我们会重新发送验证邮件。</p>
        </AuthNotice>
      ) : null}
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
          error={fieldError}
          disabled={pending}
          autoFocus
        />
        <InlineError>{error}</InlineError>
        <SubmitButton pending={pending} pendingText="发送中…">
          {compact ? "重新发送验证邮件" : "发送验证邮件"}
        </SubmitButton>
        <p className="text-center text-label">
          <Link href="/auth/login" className={textLink}>
            返回登录
          </Link>
        </p>
      </form>
    </div>
  );
}
