import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

/**
 * Better Auth 客户端实例（M1 / ORB-005）。
 *
 * 版本纪律（AGENTS.md）：使用 `better-auth@1.7.3` 的 `better-auth/react` 导出
 * （createAuthClient），不混用其它版本或 `@better-auth/*` 内部路径的示例。
 *
 * 边界（AGENTS.md、docs/03 §3、ESLint no-restricted-imports）：
 *  - **不导入** `@/server/auth`（server-only，会污染客户端 bundle），因此这是
 *    一个「泛型」客户端：不做 `$InferAuth` 的服务端类型推断。方法名与端点路径
 *    由库的客户端代理按约定映射（camelCase → kebab-case 路径），如
 *    `requestPasswordReset` → POST `/api/auth/request-password-reset`。
 *  - 同源调用：不显式传 baseURL，客户端默认使用当前站点 origin，经 /api/auth/* 与服务端通信。
 *
 * 客户端方法与本项目用到的端点对照：
 *  - signIn.email({ email, password, callbackURL? })  → POST /sign-in/email
 *  - signUp.email({ email, password, name })          → POST /sign-up/email
 *  - signOut()                                         → POST /sign-out
 *  - requestPasswordReset({ email, redirectTo? })      → POST /request-password-reset
 *  - resetPassword({ newPassword, token })             → POST /reset-password
 *  - sendVerificationEmail({ email, callbackURL? })    → POST /send-verification-email
 *  - useSession()                                      → 订阅 GET /get-session
 */
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields({ user: { timezone: { type: "string", required: false } } })],
});

/** 会话类型（泛型客户端推断：{ user, session } | null）。 */
export type AuthClientSession = ReturnType<typeof authClient.useSession>["data"];
