"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { InlineError } from "@/components/ui/inline-error";
import { AuthNotice, PasswordField, SubmitButton, TextField, textLink } from "./auth-form";
import { useSignUp } from "./use-auth";
import { isValidEmail, isValidName, isValidPasswordLength, NAME_MAX } from "./validation";

/**
 * 注册表单（/auth/register）。
 *
 * 字段：姓名、邮箱、密码、确认密码。注册不直接建立会话：成功后切换到「验证邮件已发送」，
 * 用户点击邮件里的链接完成验证并自动登录。客户端即时校验，服务端是权威。
 */
export function RegisterForm() {
  const { signUp, pending, error } = useSignUp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
    confirm?: string;
  }>({});

  if (submitted) {
    return (
      <AuthNotice
        tone="success"
        icon={<MailCheck />}
        title="验证邮件已发送"
        actions={
          <>
            <Link href="/auth/verify" className={buttonVariants({ variant: "secondary", size: "lg", className: "w-full" })}>
              前往验证页
            </Link>
            <Link href="/auth/login" className={textLink}>
              返回登录
            </Link>
          </>
        }
      >
        <p>
          我们已向 <span className="font-medium text-foreground [overflow-wrap:anywhere]">{email}</span> 发送了一封验证邮件。
          点击邮件中的按钮完成验证，验证后会自动为你登录。
        </p>
        <p className="text-caption text-foreground-muted">没收到？检查垃圾邮件，或前往验证页重新发送。</p>
      </AuthNotice>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: typeof fieldErrors = {};
    if (!isValidName(name)) {
      nextErrors.name = name.trim().length === 0 ? "请输入你的姓名。" : "姓名需为 1—40 个字符。";
    }
    if (!isValidEmail(email)) nextErrors.email = "请输入有效的邮箱地址。";
    if (!isValidPasswordLength(password)) nextErrors.password = "密码需为 12–128 个字符。";
    if (confirm !== password) nextErrors.confirm = "两次输入的密码不一致。";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    // 失败时错误由 useSignUp 给出，输入保持不变。
    const ok = await signUp({ name: name.trim(), email: email.trim(), password });
    if (ok) setSubmitted(true);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <TextField
        label="姓名"
        name="name"
        autoComplete="name"
        placeholder="你的称呼"
        maxLength={NAME_MAX}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={fieldErrors.name}
        disabled={pending}
        autoFocus
      />
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
      />
      <PasswordField
        label="密码"
        name="password"
        autoComplete="new-password"
        placeholder="至少 12 个字符"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fieldErrors.password}
        showStrength
        disabled={pending}
      />
      <PasswordField
        label="确认密码"
        name="confirmPassword"
        autoComplete="new-password"
        placeholder="再次输入密码"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={fieldErrors.confirm}
        disabled={pending}
      />

      {error && <InlineError role="alert">{error}</InlineError>}

      <SubmitButton pending={pending} pendingText="注册中…">
        注册
      </SubmitButton>

      <p className="text-center text-label text-foreground-secondary">
        已有账号？
        <Link href="/auth/login" className={`ml-1 ${textLink}`}>
          登录
        </Link>
      </p>
    </form>
  );
}
