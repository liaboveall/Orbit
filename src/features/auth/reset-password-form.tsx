"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CircleCheck, KeyRound } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { InlineError } from "@/components/ui/inline-error";
import { AuthNotice, PasswordField, SubmitButton } from "./auth-form";
import { useResetPassword } from "./use-auth";
import { isValidPasswordLength } from "./validation";

/**
 * 重设密码表单（/auth/reset-password?token=…）。
 *
 * token 来自重置邮件里的链接。重设成功后服务端会撤销该用户的全部会话，所以引导重新登录。
 * 缺少 token 或链接失效时给出说明，不暴露细节。
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
      <AuthNotice
        tone="warning"
        icon={<KeyRound />}
        title="重置链接无效"
        actions={
          <Link href="/auth/forgot-password" className={buttonVariants({ size: "lg", className: "w-full" })}>
            重新申请
          </Link>
        }
      >
        <p>这个密码重置链接缺少令牌或已失效。请重新申请一封重置邮件。</p>
      </AuthNotice>
    );
  }

  if (done) {
    return (
      <AuthNotice
        tone="success"
        icon={<CircleCheck />}
        title="密码已重设"
        actions={
          <Link href="/auth/login" className={buttonVariants({ size: "lg", className: "w-full" })}>
            前往登录
          </Link>
        }
      >
        <p>你的密码已更新。为保障安全，其它设备上的登录都已失效，请用新密码重新登录。</p>
      </AuthNotice>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // 空 token 已在上面拦截，这里只为在闭包里把类型收窄为 string。
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
      // 网络或服务端错误已由 useResetPassword 给出。
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
