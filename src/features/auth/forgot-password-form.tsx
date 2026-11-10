"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/inline-error";
import { AuthNotice, SubmitButton, TextField, textLink } from "./auth-form";
import { useRequestPasswordReset } from "./use-auth";
import { isValidEmail } from "./validation";

/**
 * 找回密码表单（/auth/forgot-password）。
 *
 * 服务端对邮箱存在和不存在返回同一个成功响应，所以这里始终显示同一句
 * 「如果该邮箱已注册，你将收到重置邮件」，不泄露账户是否存在。
 */
export function ForgotPasswordForm() {
  const { requestReset, pending, error } = useRequestPasswordReset();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  if (submitted) {
    return (
      <AuthNotice
        icon={<MailCheck />}
        title="检查你的邮箱"
        actions={
          <>
            <Button
              variant="secondary"
              size="lg"
              className="w-full"
              onClick={() => {
                setSubmitted(false);
                setEmail("");
              }}
            >
              返回重新填写
            </Button>
            <Link href="/auth/login" className={textLink}>
              返回登录
            </Link>
          </>
        }
      >
        <p>如果该邮箱已注册，你将收到一封密码重置邮件。请点击邮件中的链接设置新密码。</p>
        <p className="text-caption text-foreground-muted">
          链接 1 小时内有效。没有收到？确认邮箱拼写、检查垃圾邮件，或返回重新填写再次提交。
        </p>
      </AuthNotice>
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
      // 无论邮箱是否存在，服务端都返回成功，据此显示统一文案。
      const ok = await requestReset(email.trim());
      if (ok) setSubmitted(true);
    } catch {
      // 网络或服务端错误已由 useRequestPasswordReset 给出。
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
        <Link href="/auth/login" className={`ml-1 ${textLink}`}>
          返回登录
        </Link>
      </p>
    </form>
  );
}
