import "server-only";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { PrismaClient } from "@/generated/prisma/client";
import type { OrbitEnv } from "@/server/env";
import { createEmailSender } from "./email";
import { resolveClientIp } from "@/server/http/client-ip";
import { consumeBucket } from "@/server/modules/rate-limit/postgres";
import { logEvent } from "@/server/http/log";

const AUTH_IP_HEADER = "x-orbit-auth-client-ip";
import { registrationTimezone, requireUserName, requireUserTimezone } from "./user-fields";

/**
 * Better Auth 配置工厂（M1 / ORB-004）。
 *
 * 版本纪律（AGENTS.md）：所有配置项名称与认证表字段均对照已安装的
 * `better-auth@1.7.3` / `@better-auth/core@1.7.3` 的类型与 schema 定义，不混用其它版本示例。
 *
 * 设计要点（docs/03 §5、docs/04 §3、docs/08 §3）：
 *  - 数据库会话（无 secondary storage，默认落库到 Session 表），不手动伪造 cookie。
 *  - HttpOnly + SameSite=Lax 为库默认；Secure 由 `advanced.useSecureCookies` 控制，
 *    仅在 baseURL 为 https（生产/staging）时开启，本地 http 开发不强制以免 cookie 无法下发。
 *  - trustedOrigins 精确来自 AUTH_TRUSTED_ORIGINS（不含通配符，见 env 校验）。
 *  - 邮箱密码：12–128 位、注册后需邮箱验证方可建立会话。
 *  - User.timezone 为业务扩展字段（additionalFields），默认 Asia/Shanghai。
 *  - 邮件发送接入真实 nodemailer + SMTP（本地 Mailpit）：见 ./email.ts 的 createEmailSender。
 *  - 重设密码后撤销该用户所有既有会话（revokeSessionsOnPasswordReset）；未验证用户登录时重发验证邮件（sendOnSignIn）。
 *  - 敏感认证端点启用 Better Auth 内置限流（rateLimit）：test 环境关闭以便集成测试多次登录，其余环境启用。
 *
 * 该工厂不绑定任何单例，便于集成测试用独立测试库客户端构造隔离实例。
 */

/** 解析逗号分隔的可信源列表（env 校验已保证非空且无通配符）。 */
function parseTrustedOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 构造 Better Auth 配置对象（纯函数，不创建实例）。
 *
 * 用 `satisfies BetterAuthOptions` 而非返回类型标注：保留对象字面量的窄类型
 * （尤其 user.additionalFields.timezone 的 `type: "string"` 字面量），使 betterAuth()
 * 能推断出带 timezone 的 User 类型；若标注为宽类型 BetterAuthOptions 会丢失扩展字段推断。
 */
export function createAuthOptions(prisma: PrismaClient, env: OrbitEnv) {
  const useSecureCookies = env.BETTER_AUTH_URL.startsWith("https://");
  // 真实邮件发送器（nodemailer + SMTP）。按 env 绑定，测试用独立 env 得到独立 transport。
  const email = createEmailSender(env);

  return {
    appName: "Orbit",
    logger: {
      level: env.LOG_LEVEL,
      // Library messages/args can contain SMTP replies, URLs or submitted values.
      log: (level) => logEvent(level, { event: "auth_library_event" }),
    },
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: parseTrustedOrigins(env.AUTH_TRUSTED_ORIGINS),
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      // 重设密码成功后撤销该用户所有既有会话（ORB-005 交付物 #8）。
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: email.sendResetPassword,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      // 未验证用户尝试登录时重发验证邮件（requireEmailVerification 下登录被拒，引导其完成验证）。
      sendOnSignIn: true,
      sendVerificationEmail: email.sendVerificationEmail,
    },
    user: {
      additionalFields: {
        // 接收首次注册浏览器时区；数据库钩子统一校验创建和更新入口。
        timezone: {
          type: "string",
          required: false,
          defaultValue: "Asia/Shanghai",
          input: true,
          returned: true,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: {
              ...user,
              name: requireUserName(user.name),
              timezone: registrationTimezone("timezone" in user ? user.timezone : undefined),
            },
          }),
        },
        update: {
          before: async (user) => ({
            data: {
              ...user,
              // F06 修复：V1 无头像功能，库自带 update-user 通道的 image 字段写穿在此
              // 置空（Prisma 语义 = 不写该列），防止绕过业务字段规则写入任意值。
              image: undefined,
              ...(user.name !== undefined ? { name: requireUserName(user.name) } : {}),
              ...("timezone" in user && user.timezone !== undefined
                ? { timezone: requireUserTimezone(user.timezone) } : {}),
            },
          }),
        },
      },
    },
    session: {
      // 数据库会话：7 天过期、每 1 天刷新（库默认，此处显式声明意图）。
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    // F06 说明：/api/auth/* 实际开放的写端点 = sign-up / sign-in / sign-out /
    // forgot-password / reset-password / verify-email / update-user（name、timezone；
    // image 已在上面的数据库钩子剥离；changeEmail 与 deleteUser 默认关闭，未启用）。
    // 该通道的限流使用 better-auth 内置限流（阈值独立于 /api/v1 的应用限流），两者
    // 差异是已记录的取舍：认证端点在 Nginx 64k 预算内、由库按 IP+路径限流。
    rateLimit: {
      // 库默认仅生产启用；此处显式：test 关闭（集成测试需多次登录/注册，另有独立实例专门验证限流），
      // development/staging/production 启用以保护真实认证端点。超限返回 429 + X-Retry-After 头。
      enabled: env.APP_ENV !== "test",
      window: 60,
      max: 100,
      // 单实例内存存储（无 secondary storage）；多实例部署应切换为 database/secondary-storage。
      storage: "memory",
      ...(["staging", "production"].includes(env.APP_ENV) ? {
        customStorage: {
          consume: async (key: string, rule: { max: number; window: number }) => {
            const result = await consumeBucket(prisma, "auth", key, rule.max, rule.window);
            return { allowed: result.allowed, retryAfter: result.allowed ? null : result.resetAfter };
          },
        },
      } : {}),
      // 覆盖库默认特殊规则，为敏感端点设定更明确、窗口更长的阈值（键为去除 basePath 后的路径）。
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 10 },
        "/request-password-reset": { window: 60, max: 5 },
        "/reset-password": { window: 60, max: 10 },
        "/send-verification-email": { window: 60, max: 5 },
        "/verify-email": { window: 60, max: 20 },
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: [AUTH_IP_HEADER] },
      // 仅 https/生产强制 Secure；HttpOnly + SameSite=Lax 由库默认保证。
      useSecureCookies,
    },
  } satisfies BetterAuthOptions;
}

/** 用给定 Prisma 客户端与环境创建一个独立的 Better Auth 实例（供应用单例与测试复用）。 */
export function createAuth(prisma: PrismaClient, env: OrbitEnv) {
  const instance = betterAuth(createAuthOptions(prisma, env));
  return {
    ...instance,
    handler: (request: Request) => {
      const headers = new Headers(request.headers);
      // Never trust a caller-supplied internal header. A deployment without a
      // trusted proxy deliberately shares one bucket rather than trusting XFF.
      const ip = resolveClientIp(headers.get("x-forwarded-for") ?? undefined, env.TRUSTED_PROXY_COUNT);
      headers.set(AUTH_IP_HEADER, ip === "__no-trusted-proxy__" ? "0.0.0.0" : ip);
      return instance.handler(new Request(request, { headers }));
    },
  };
}
