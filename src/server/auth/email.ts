import "server-only";
import { logEvent } from "@/server/http/log";
import type { SendMailOptions } from "nodemailer";
import { sendMailWithBudget } from "./smtp";
import type { OrbitEnv } from "@/server/env";

/**
 * 认证邮件发送（M1 / ORB-005）：用真实 nodemailer + SMTP（本地 Mailpit）替换 ORB-004 的占位日志。
 *
 * 版本纪律（AGENTS.md）：nodemailer@10.0.1，使用其自带的 `createTransport` / `SendMailOptions` 类型，
 * 不混用旧版 `@types/nodemailer` 或其它版本示例。
 *
 * 设计要点：
 *  - transport 从 env 读取 host/port/secure；Mailpit 无需 auth/TLS（SMTP_USER/SMTP_PASSWORD 为空即不启用）。
 *  - 每次投递使用独立 transport 和可取消 socket（未启用连接池）；总预算到期关闭本次连接，
 *    使集成测试用独立 env 时得到独立 transport，绝不跨实例串用。
 *  - 安全（docs/03 §8）：邮件正文**不含**密码明文、**不含**完整 session token。验证/重置链接携带的
 *    是可过期的 token（库生成；重设令牌单次使用），属正常流程；日志只记录脱敏信息（用途 + userId）。
 *  - 链接构造：
 *      · 验证邮件 → Better Auth 内置 GET `/api/auth/verify-email?token=...&callbackURL=/auth/verify`
 *        （点击后库校验 token、置 emailVerified、按 autoSignInAfterVerification 建会话，再重定向到 /auth/verify）。
 *      · 重置邮件 → 应用自有页 `/auth/reset-password?token=...`（该页收集新密码后调用 POST /reset-password）。
 */

/** 与 Better Auth `emailVerification.sendVerificationEmail` / `emailAndPassword.sendResetPassword` 对齐的入参。 */
export interface AuthMailPayload {
  user: { id: string; email: string; name?: string | null };
  /** 库预置的完整回调 URL（含 token）。验证流程直接复用其 origin+path，仅覆写 callbackURL。 */
  url: string;
  /** 单次使用、可过期的令牌（用于自造指向应用页面的链接，如重置密码页）。 */
  token: string;
}

/** 邮件发送器：两个 hook 实现，供 createAuthOptions 直接接入。 */
export interface EmailSender {
  sendVerificationEmail: (data: AuthMailPayload, request?: Request) => Promise<void>;
  sendResetPassword: (data: AuthMailPayload, request?: Request) => Promise<void>;
}

/** 转义 HTML 文本，避免用户名等注入邮件模板（简单实体转义即可，正文不使用富文本编辑器内容）。 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 统一的邮件外壳：Orbit 字标 + 标题 + 正文 + 主行动按钮 + 页脚。全部内联样式（邮件客户端兼容）。 */
function renderEmail(opts: {
  title: string;
  intro: string;
  actionLabel: string;
  actionUrl: string;
  footnote: string;
  userName?: string | null;
}): { html: string; text: string } {
  const { title, intro, actionLabel, actionUrl, footnote, userName } = opts;
  const greeting = userName && userName.trim().length > 0 ? `${escapeHtml(userName.trim())}，你好` : "你好";
  const safeUrl = escapeHtml(actionUrl);

  const html = `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:0;background:#f7f8fa;font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif;color:#171a21;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e2e6ed;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <span style="display:inline-flex;align-items:center;gap:8px;font-size:20px;font-weight:600;letter-spacing:-0.01em;color:#171a21;">
                  <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#355cff;"></span>
                  Orbit
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 32px 8px 32px;">
                <h1 style="margin:0;font-size:20px;line-height:1.25;font-weight:600;color:#171a21;">${escapeHtml(title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px 32px;">
                <p style="margin:0 0 20px 0;font-size:16px;line-height:1.6;color:#5b6472;">${greeting}，${escapeHtml(intro)}</p>
                <p style="margin:0 0 24px 0;">
                  <a href="${safeUrl}" style="display:inline-block;background:#355cff;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;padding:12px 22px;border-radius:8px;">${escapeHtml(actionLabel)}</a>
                </p>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#5b6472;">${escapeHtml(footnote)}</p>
                <p style="margin:8px 0 0 0;font-size:12px;line-height:1.5;color:#6b7280;word-break:break-all;">
                  若按钮无法点击，请复制此链接到浏览器：<br/><a href="${safeUrl}" style="color:#355cff;">${safeUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 28px 32px;border-top:1px solid #e2e6ed;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#6b7280;">这是一封来自 Orbit 的系统邮件，请勿直接回复。如果你没有发起此操作，可以安全地忽略。</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `Orbit — ${title}`,
    "",
    `${greeting}，${intro}`,
    "",
    `${actionLabel}：${actionUrl}`,
    "",
    footnote,
    "",
    "这是一封来自 Orbit 的系统邮件，请勿直接回复。如果你没有发起此操作，可以安全地忽略。",
  ].join("\n");

  return { html, text };
}

/**
 * 构造验证链接：复用库给出的 URL 的 origin+path（即 `<baseURL>/verify-email`）与 token，
 * 仅把 callbackURL 覆写为应用自有验证结果页 `/auth/verify`。这样验证成功后库会重定向到该页展示状态。
 */
function buildVerifyLink(providedUrl: string): string {
  const parsed = new URL(providedUrl);
  parsed.searchParams.set("callbackURL", "/auth/verify");
  return parsed.toString();
}

/** 构造重置链接：直接指向应用自有重设页，携带单次使用 token（该页收集新密码后 POST /reset-password）。 */
function buildResetLink(env: OrbitEnv, token: string): string {
  const base = env.APP_URL.replace(/\/+$/, "");
  return `${base}/auth/reset-password?token=${encodeURIComponent(token)}`;
}

/** 统一的发信封装：填充发件人/收件人/主题，并记录脱敏日志（不含 token / URL / 明文邮箱）。 */
async function send(
  env: OrbitEnv,
  payload: AuthMailPayload,
  kind: "verify-email" | "reset-password",
  subject: string,
  body: { html: string; text: string },
): Promise<void> {
  const message: SendMailOptions = {
    from: env.MAIL_FROM,
    to: payload.user.email,
    subject,
    text: body.text,
    html: body.html,
  };

  try {
    await sendMailWithBudget(env, message);
  } catch {
    logEvent("error", { event: "auth_email_failed", kind });
    throw new Error("Email delivery failed");
  }
  // 脱敏日志（docs/03 §8）：只记录用途与内部 userId，绝不输出 token / 链接 / 明文邮箱。
  logEvent("info", { event: "auth_email_sent", kind, userId: payload.user.id });
}

/**
 * 创建与给定 env 绑定的邮件发送器（纯工厂，不持有全局单例，便于集成测试用独立测试 env 构造）。
 */
export function createEmailSender(env: OrbitEnv): EmailSender {
  return {
    sendVerificationEmail: async ({ user, url }) => {
      const link = buildVerifyLink(url);
      const body = renderEmail({
        title: "验证你的邮箱",
        intro: "请点击下方按钮验证邮箱地址，完成后即可登录 Orbit。此链接 1 小时内有效。",
        actionLabel: "验证邮箱",
        actionUrl: link,
        footnote: "验证成功后会自动为你创建登录会话。",
        userName: user.name,
      });
      await send(env, { user, url, token: "" }, "verify-email", "验证你的 Orbit 邮箱", body);
    },

    sendResetPassword: async ({ user, token }) => {
      const link = buildResetLink(env, token);
      const body = renderEmail({
        title: "重设你的密码",
        intro: "我们收到了你的密码重设请求。请点击下方按钮设置新密码。此链接 1 小时内有效，且仅可使用一次。",
        actionLabel: "重设密码",
        actionUrl: link,
        footnote: "为保障安全，重设密码后你的其它已登录会话都会被撤销。",
        userName: user.name,
      });
      await send(env, { user, url: link, token }, "reset-password", "重设你的 Orbit 密码", body);
    },
  };
}
