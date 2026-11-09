"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { InlineError } from "@/components/ui/inline-error";
import { SubmitButton, TextField } from "./auth-form";
import { useRequestPasswordReset } from "./use-auth";
import { isValidEmail } from "./validation";

/**
 * 找回密码表单（M1 / ORB-005，/auth/forgot-password）。
 *
 * 隐私（docs/01 FR-AUTH）：服务端对「邮箱存在/不存在」返回**同一**成功响应，
 * 因此这里始终展示统一文案「如果该邮箱已注册，你将收到重置邮件」，绝不泄露账户是否存在。
 * 重置邮件链接指向 /auth/reset-password?token=…（见 server/auth/email.ts）。
 */
export function ForgotPasswordForm() {
  const { requestReset, pending, error } = useRequestPasswordReset();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  if (submitted) {
    return (
      <div className="space-y-4 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
          <CircleCheck className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="text-section font-semibold text-foreground">检查你的邮箱</h2>
        <p className="text-label leading-relaxed text-foreground-secondary">
          如果该邮箱已注册，你将收到一封密码重置邮件。请点击邮件中的链接设置新密码。
        </p>
        <p className="text-caption text-foreground-muted">
          没有收到？确认邮箱拼写、检查垃圾邮件，或「返回重新填写」再次提交（受发送限流约束）。链接 1 小时内有效。
        </p>
        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              setSubmitted(false);
              setEmail("");
            }}
            className="inline-flex h-11 items-center justify-center rounded-control border border-line-strong bg-surface text-label font-medium text-foreground transition-colors duration-150 ease-standard hover:bg-surface-sunken"
          >
            返回重新填写
          </button>
          <Link
            href="/auth/login"
            className="text-label text-brand-ink underline-offset-4 hover:text-brand-hover hover:underline"
          >
            返回登录
          </Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidEmail(email)) {
      setFieldError("请输入有效的邮箱地址。");
      return;
    }
    setFieldError(null);
    
    try {
      const ok = await requestReset(email.trim());
      // 无论邮箱是否存在，服务端都返回成功；据此展示统一文案。
      if (ok) setSubmitted(true);
    } catch {
      // Network or server error - error is already set by useRequestPasswordReset hook
    }
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
        hint="输入注册时使用的邮箱，我们会发送重置链接。"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldError}
        disabled={pending}
        autoFocus
      />

      <InlineError>{error}</InlineError>

      <SubmitButton pending={pending} pendingText="发送中…">
        发送重置邮件
      </SubmitButton>

      <p className="text-center text-label text-foreground-secondary">
        想起来了？
        <Link
          href="/auth/login"
          className="ml-1 text-brand-ink underline-offset-4 transition-colors duration-150 ease-standard hover:text-brand-hover hover:underline"
        >
          返回登录
        </Link>
      </p>
    </form>
  );
}
