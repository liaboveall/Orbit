"use client";

import { useCallback, useState } from "react";
import { deviceTimezone } from "@/features/settings/timezones";
import { authClient } from "./auth-client";

/**
 * 认证客户端 hooks（M1 / ORB-005）。
 *
 * 对 `better-auth/react` 客户端（./auth-client）的薄封装：为每个动作提供
 * `pending`（提交中，用于禁用按钮 + spinner）与 `error`（驻留错误文案，配合 InlineError）。
 *
 * 边界（AGENTS.md、ESLint）：本文件属客户端层，只依赖 auth-client 与 lib，
 * **不导入** @/server（server-only）。错误映射基于 HTTP status + code（BetterFetchError 暴露
 * status/message/code），避免依赖 any：
 *  - 未验证邮箱 → **仅**由 `code === "EMAIL_NOT_VERIFIED"` 精确判定（服务端在校验密码通过后
 *    才判定未验证，见 sign-in 路由），故提示「未验证」不构成账户存在性泄露，且服务端已按
 *    sendOnSignIn 重发验证邮件。**不可**用 `status === 403` 兜底判定未验证 —— Origin 校验
 *    失败同样返回 403，会被误判为「未验证」并误导用户。
 *  - 其余 403（如 Origin 校验失败）→ 单独提示「登录请求被拒绝」。
 *  - 429 → 限流；其余（401 等）→ 统一「邮箱或密码不正确」（不泄露账户是否存在）。
 */

/** 会话订阅 hook（转发客户端 useSession）。 */
export function useSession() {
  return authClient.useSession();
}

/** 客户端返回的错误对象中我们需要的字段（BetterFetchError 暴露 status/statusText，并带可选 code/message）。 */
type FetchError = { status: number; code?: string; message?: string } | null | undefined;

/** 登录错误 → 面向用户文案（不泄露账户存在性）。 */
export function describeSignInError(error: FetchError): string {
  if (!error) return "登录失败，请稍后再试。";
  if (error.code === "RATE_LIMITED" || error.status === 429) return "尝试过于频繁，请稍后再试。";
  // EMAIL_NOT_VERIFIED：服务端在校验密码通过后才判定未验证，故提示未验证不泄露账户存在性，
  // 且服务端已按 sendOnSignIn 重发验证邮件。**仅**按 code 精确判定，不用 403 兜底
  // （Origin 校验失败也返回 403，若用 status 兜底会把它误判为「未验证」）。
  if (error.code === "EMAIL_NOT_VERIFIED") {
    return "邮箱尚未验证。我们已重新发送验证邮件，请查收后点击链接完成验证，再登录。";
  }
  // 其余 403（如 Origin 校验失败）：与「未验证」区分，引导用户从应用内页面重试。
  if (error.status === 403) return "登录请求被拒绝，请确认从应用内页面重试。";
  return "邮箱或密码不正确。";
}

/** 通用错误 → 面向用户文案。 */
export function describeError(error: FetchError, fallback: string): string {
  if (!error) return fallback;
  if (error.code === "RATE_LIMITED" || error.status === 429) return "尝试过于频繁，请稍后再试。";
  return error.message && error.message.length > 0 ? error.message : fallback;
}

/** 登录：成功返回 true（由调用方决定跳转），失败返回 false 并置 error/needsVerification。 */
export function useSignIn() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);

  const signIn = useCallback(async (email: string, password: string) => {
    setPending(true);
    setError(null);
    setNeedsVerification(false);
    try {
      const res = await authClient.signIn.email({ email, password });
      setPending(false);
      if (res.error) {
        const unverified = res.error.code === "EMAIL_NOT_VERIFIED";
        setNeedsVerification(unverified);
        setError(describeSignInError(res.error));
        return false;
      }
      return true;
    } catch (error) {
      setPending(false);
      // Distinguish network errors from server/API errors
      if (error instanceof TypeError && error.message === 'Failed to fetch') {
        setError('网络错误，请检查您的网络连接后重试');
      } else {
        // Server/API error - fall back to default message
        setError("登录失败，请稍后再试。");
      }
      return false;
    }
  }, []);

  return { signIn, pending, error, needsVerification };
}

/** 注册：requireEmailVerification 下不建会话，成功后应引导用户去邮箱验证。 */
export function useSignUp() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signUp = useCallback(
    async (input: { name: string; email: string; password: string }) => {
      setPending(true);
      setError(null);
      try {
        const res = await authClient.signUp.email({
          name: input.name,
          email: input.email,
          password: input.password,
          timezone: deviceTimezone(),
        });
        setPending(false);
        if (res.error) {
          setError(describeError(res.error, "注册失败，请检查填写内容后重试。"));
          return false;
        }
        return true;
      } catch (error) {
        setPending(false);
        // Distinguish network errors from server/API errors
        if (error instanceof TypeError && error.message === 'Failed to fetch') {
          setError('网络错误，请检查您的网络连接后重试');
        } else {
          setError('注册失败，请稍后再试');
        }
        return false;
      }
    },
    [],
  );

  return { signUp, pending, error };
}

/** 退出登录：清理会话 cookie（客户端状态由 useSession 自动更新）。返回 undefined 表示成功，非空 error 对象表示失败。 */
export function useSignOut() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = useCallback(async (): Promise<{ error?: string }> => {
    setPending(true);
    setError(null);
    try {
      const res = await authClient.signOut();
      setPending(false);
      if (res?.error) {
        setError('退出失败，请稍后再试');
        return { error: 'sign out failed' };
      }
      return {};
    } catch (err) {
      setPending(false);
      // Distinguish network errors from other errors
      if (err instanceof TypeError && err.message === 'Failed to fetch') {
        setError('网络错误，请检查您的网络连接后重试');
      } else {
        setError('退出失败，请稍后再试');
      }
      return { error: 'sign out error' };
    }
  }, []);

  return { signOut, pending, error };
}

/** 找回密码：服务端对存在/不存在的邮箱返回同一响应，故成功文案不泄露账户存在性。 */
export function useRequestPasswordReset() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestReset = useCallback(async (email: string, redirectTo?: string) => {
    setPending(true);
    setError(null);
    try {
      const res = await authClient.requestPasswordReset(
        redirectTo ? { email, redirectTo } : { email },
      );
      setPending(false);
      if (res.error) {
        setError(describeError(res.error, "请求失败，请稍后再试。"));
        return false;
      }
      return true;
    } catch (err) {
      setPending(false);
      // Distinguish network errors from server/API errors
      if (err instanceof TypeError && err.message === 'Failed to fetch') {
        setError('网络错误，请检查您的网络连接后重试');
      } else {
        setError('请求失败，请稍后再试');
      }
      return false;
    }
  }, []);

  return { requestReset, pending, error };
}

/** 重设密码：token 来自重置邮件链接；成功后服务端会撤销该用户既有会话。 */
export function useResetPassword() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetPassword = useCallback(async (token: string, newPassword: string) => {
    setPending(true);
    setError(null);
    try {
      const res = await authClient.resetPassword({ newPassword, token });
      setPending(false);
      if (res.error) {
        setError(describeError(res.error, "重设失败，链接可能已失效，请重新申请。"));
        return false;
      }
      return true;
    } catch (err) {
      setPending(false);
      // Distinguish network errors from server/API errors
      if (err instanceof TypeError && err.message === 'Failed to fetch') {
        setError('网络错误，请检查您的网络连接后重试');
      } else {
        setError('重设失败，请稍后再试');
      }
      return false;
    }
  }, []);

  return { resetPassword, pending, error };
}

/** 重发验证邮件（验证页/未验证登录时提供）。 */
export function useResendVerification() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resend = useCallback(async (email: string) => {
    setPending(true);
    setError(null);
    try {
      const res = await authClient.sendVerificationEmail({
        email,
        callbackURL: "/auth/verify",
      });
      setPending(false);
      if (res.error) {
        setError(describeError(res.error, "发送失败，请稍后再试。"));
        return false;
      }
      return true;
    } catch (err) {
      setPending(false);
      // Distinguish network errors from server/API errors
      if (err instanceof TypeError && err.message === 'Failed to fetch') {
        setError('网络错误，请检查您的网络连接后重试');
      } else {
        setError('发送失败，请稍后再试');
      }
      return false;
    }
  }, []);

  return { resend, pending, error };
}
