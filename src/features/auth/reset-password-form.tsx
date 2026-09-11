"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CircleCheck, KeyRound } from "lucide-react";
import { InlineError } from "@/components/ui/inline-error";
import { PasswordField, SubmitButton } from "./auth-form";
import { useResetPassword } from "./use-auth";
import { isValidPasswordLength } from "./validation";

/**
 * 重设密码表单（M1 / ORB-005，/auth/reset-password?token=…）。
 *
 * token 来自重置邮件链接（server/auth/email.ts 构造）。提交调用 POST /reset-password
 * （newPassword + token）。成功后服务端因 revokeSessionsOnPasswordReset 撤销该用户所有既有会话，
 * 因此引导用户重新登录。缺少 token 或链接失效时给出清晰提示，不暴露细节。
 */
export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const { resetPassword, pending, error } = useResetPassword();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});

  if (!token || token.trim().length === 0) {
    return (
      <div className="space-y-4 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning-soft text-warning">
          <KeyRound className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="text-section font-semibold text-foreground">重置链接无效</h2>
        <p className="text-label leading-relaxed text-foreground-secondary">
          这个密码重置链接缺少令牌或已失效。请重新申请一封重置邮件。
        </p>
        <Link
          href="/auth/forgot-password"
          className="inline-flex h-11 w-full items-center justify-center rounded-control bg-brand text-label font-medium text-foreground-invert transition-colors duration-150 ease-standard hover:bg-brand-hover"
        >
          重新申请
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success">
          <CircleCheck className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="text-section font-semibold text-foreground">密码已重设</h2>
        <p className="text-label leading-relaxed text-foreground-secondary">
          你的密码已更新。为保障安全，其它设备上的登录会话都已被撤销，请用新密码重新登录。
        </p>
        <Link
          href="/auth/login"
          className="inline-flex h-11 w-full items-center justify-center rounded-control bg-brand text-label font-medium text-foreground-invert transition-colors duration-150 ease-standard hover:bg-brand-hover"
        >
          前往登录
        </Link>
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // 外层已拦截空 token（渲染无效态）；此处守卫仅为在闭包内将 token 收窄为 string。
    if (!token) return;
    const nextErrors: typeof fieldErrors = {};
    if (!isValidPasswordLength(password)) nextErrors.password = "密码需为 12–128 个字符。";
    if (confirm !== password) nextErrors.confirm = "两次输入的密码不一致。";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    try {
      const ok = await resetPassword(token, password);
      if (ok) setDone(true);
    } catch {
      // Network or server error - error is already set by useResetPassword hook
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <PasswordField
        label="新密码"
        name="newPassword"
        autoComplete="new-password"
        placeholder="至少 12 个字符"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fieldErrors.password}
        showStrength
        disabled={pending}
        autoFocus
      />
      <PasswordField
        label="确认新密码"
        name="confirmPassword"
        autoComplete="new-password"
        placeholder="再次输入新密码"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={fieldErrors.confirm}
        disabled={pending}
      />

      <InlineError>{error}</InlineError>

      <SubmitButton pending={pending} pendingText="重设中…">
        重设密码
      </SubmitButton>
    </form>
  );
}
