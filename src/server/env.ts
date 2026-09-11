import "server-only";
import { z } from "zod";

/**
 * Orbit 环境配置校验（M0 / ORB-001）。
 *
 * 设计约束（见 docs/08 §3、AGENTS.md）：
 *  - 在服务启动期校验必需项（由 src/instrumentation.ts 触发）。
 *  - 校验失败时只暴露「变量名 + 预期格式」，绝不回显任何变量值或秘密。
 *  - 秘密/凭证类变量禁止 NEXT_PUBLIC 前缀（否则会进入客户端 bundle）。
 *  - 测试库必须独立：TEST_DATABASE_URL 拒绝开发/生产库名。
 *  - AI 默认关闭：AI_ENABLED=false 时不要求任何 AI_* 凭证。
 *
 * 说明：Better Auth 属 M1，本文件仅按 .env.example 对齐变量形状；
 * BETTER_AUTH_SECRET 在 development 下允许为空（M1 接入前不阻塞本地启动），
 * 在 test/staging/production 下强制要求足够长度的随机值。
 */

export const APP_ENVS = ["development", "test", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** 秘密/凭证类变量：任何情况下都不得以 NEXT_PUBLIC_ 前缀暴露给客户端。 */
export const SECRET_KEYS = [
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "SMTP_PASSWORD",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
  "AI_API_KEY",
] as const;

/** 触发「疑似秘密」判定的关键词（用于拦截 NEXT_PUBLIC_*SECRET 之类）。 */
const SECRET_HINT = /(SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|TOKEN|DATABASE_URL|PRIVATE)/i;

/** 各变量的「预期格式」说明——错误信息只用这些文案，不回显实际值。 */
const EXPECTED_FORMAT: Record<string, string> = {
  APP_ENV: `必须是枚举之一：${APP_ENVS.join(" | ")}`,
  APP_URL: "必须是完整的同源地址（http:// 或 https://）",
  DATABASE_URL: "必须是 postgresql:// 连接串（客户端不可见）",
  TEST_DATABASE_URL: "必须是 postgresql:// 连接串，且指向独立的测试库（不得为开发/生产库名）",
  BETTER_AUTH_URL: "必须是完整地址，且与 APP_URL 一致",
  BETTER_AUTH_SECRET: "非 development 环境必须提供，且长度 ≥ 32 的安全随机值",
  AUTH_TRUSTED_ORIGINS: "必须是逗号分隔的精确来源列表（http(s)://host[:port]），不得使用通配符 *",
  SMTP_HOST: "必须提供 SMTP 主机名",
  SMTP_PORT: "必须是 1–65535 的整数",
  SMTP_SECURE: "必须是布尔字符串：true | false | 1 | 0",
  MAIL_FROM: "必须提供发件身份，例如 Orbit <no-reply@orbit.local>",
  STORAGE_ENDPOINT: "必须是 S3 兼容地址（http:// 或 https://）",
  STORAGE_REGION: "必须提供存储区域",
  STORAGE_BUCKET: "必须提供私有 bucket 名称",
  STORAGE_ACCESS_KEY_ID: "必须提供服务端访问凭证 ID",
  STORAGE_SECRET_ACCESS_KEY: "必须提供服务端访问凭证密钥",
  STORAGE_FORCE_PATH_STYLE: "必须是布尔字符串：true | false | 1 | 0",
  LOG_LEVEL: `必须是枚举之一：${LOG_LEVELS.join(" | ")}`,
  AI_ENABLED: "必须是布尔字符串：true | false | 1 | 0",
  AI_PROVIDER: "AI_ENABLED=true 时必须提供 provider",
  AI_MODEL: "AI_ENABLED=true 时必须提供 model",
  AI_API_KEY: "AI_ENABLED=true 时必须提供 API key（仅服务端）",
  AI_DAILY_REQUEST_LIMIT: "必须是 ≥ 1 的整数",
  TRUSTED_PROXY_COUNT: "必须是 0–10 的整数（受信任反向代理跳数）",
};

/** 布尔型环境变量解析：显式接受 true/false/1/0，避免 Boolean("false") === true 陷阱。 */
function boolEnv(defaultValue: boolean) {
  return z
    .enum(["true", "false", "1", "0"])
    .optional()
    .default(defaultValue ? "true" : "false")
    .transform((v) => v === "true" || v === "1");
}

/** postgres 连接串（不回显值，仅校验前缀与可解析性）。 */
const postgresUrl = z
  .string()
  .min(1)
  .refine(
    (v) => v.startsWith("postgresql://") || v.startsWith("postgres://"),
    { message: "必须是 postgresql:// 连接串" },
  )
  .refine((v) => extractDbName(v) !== null, { message: "连接串必须包含数据库名" });

function extractDbName(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const name = url.pathname.replace(/^\//, "");
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/** 开发/生产库名模式：测试库不得命中。 */
const NON_TEST_DB_PATTERN = /(^|[_-])(dev|development|prod|production|stage|staging)([_-]|$)/i;

export const envSchema = z
  .object({
    APP_ENV: z.enum(APP_ENVS),
    APP_URL: z.string().min(1).refine((v) => isHttpUrl(v), { message: "必须是 http(s) URL" }),
    DATABASE_URL: postgresUrl,
    TEST_DATABASE_URL: postgresUrl,
    BETTER_AUTH_URL: z.string().min(1).refine((v) => isHttpUrl(v), { message: "必须是 http(s) URL" }),
    BETTER_AUTH_SECRET: z.string().optional().default(""),
    AUTH_TRUSTED_ORIGINS: z.string().min(1),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_USER: z.string().optional().default(""),
    SMTP_PASSWORD: z.string().optional().default(""),
    SMTP_SECURE: boolEnv(false),
    MAIL_FROM: z.string().min(1),
    STORAGE_ENDPOINT: z.string().min(1).refine((v) => isHttpUrl(v), { message: "必须是 http(s) URL" }),
    STORAGE_REGION: z.string().min(1),
    STORAGE_BUCKET: z.string().min(1),
    STORAGE_ACCESS_KEY_ID: z.string().min(1),
    STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
    STORAGE_FORCE_PATH_STYLE: boolEnv(false),
    LOG_LEVEL: z.enum(LOG_LEVELS).optional().default("info"),
    AI_ENABLED: boolEnv(false),
    AI_PROVIDER: z.string().optional().default(""),
    AI_MODEL: z.string().optional().default(""),
    AI_API_KEY: z.string().optional().default(""),
    AI_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(1).optional().default(10),
    // TRUSTED_PROXY_COUNT：本机前方受信任反向代理跳数（docs/03 §8）。
    // 默认 0 = 不信任任何 X-Forwarded-For，直接拒绝匿名限流按 IP 区分（退化为单一桶，
    // 见 client-ip.ts）——单 Node 进程直连场景的安全默认值。只有在确认部署拓扑中存在
    // 固定层数的受信代理（如 1 层负载均衡器）时才调大，取值即为该链路上受信代理数量。
    TRUSTED_PROXY_COUNT: z.coerce.number().int().min(0).max(10).optional().default(0),
  })
  .superRefine((value, ctx) => {
    // BETTER_AUTH_SECRET：非 development 强制要求足够长度。
    if (value.APP_ENV !== "development" && value.BETTER_AUTH_SECRET.trim().length < 32) {
      ctx.addIssue({ code: "custom", path: ["BETTER_AUTH_SECRET"] });
    }

    // AUTH_TRUSTED_ORIGINS：精确来源列表，拒绝通配符与非法项。
    const origins = value.AUTH_TRUSTED_ORIGINS.split(",").map((s) => s.trim());
    if (origins.length === 0 || origins.some((o) => o.length === 0)) {
      ctx.addIssue({ code: "custom", path: ["AUTH_TRUSTED_ORIGINS"] });
    } else if (origins.some((o) => o === "*" || o.includes("*") || !isHttpUrl(o))) {
      ctx.addIssue({ code: "custom", path: ["AUTH_TRUSTED_ORIGINS"] });
    }

    // TEST_DATABASE_URL：必须独立于开发/生产库。
    //
    // 例外（A10 E2E 测试环境隔离）：`scripts/e2e-server.mjs` 启动的测试专用服务器会
    // 把子进程的 DATABASE_URL 显式覆写为 TEST_DATABASE_URL 的值（同一个连接串），
    // 让应用运行时全程连接独立测试库而不是开发库——这是刻意的、经过 e2e-server.mjs
    // 自身校验（本机地址 + 与「原始」DATABASE_URL 不同名 + 已应用迁移）之后的安全用法，
    // 不是本规则要防的「测试库配置误写成开发库同名」。
    //
    // 因此只有当 DATABASE_URL 与 TEST_DATABASE_URL **完整连接串逐字节相同**（不仅是
    // 数据库名相同）且 APP_ENV=test 时才放行；这个条件精确对应
    // e2e-server.mjs 的行为（它把两者设成同一个字符串），不会误放行「两个连接串数据库名
    // 恰好相同但主机/凭证不同」这种更可能是误配置的场景——那种情况下 devDb/testDb 名字
    // 相同但完整字符串大概率不同，仍会被下面的分支拦住。
    const sameFullConnectionString = value.DATABASE_URL === value.TEST_DATABASE_URL;
    const isVerifiedE2eTestServer = value.APP_ENV === "test" && sameFullConnectionString;

    const devDb = extractDbName(value.DATABASE_URL);
    const testDb = extractDbName(value.TEST_DATABASE_URL);
    if (!isVerifiedE2eTestServer) {
      if (testDb && devDb && testDb.toLowerCase() === devDb.toLowerCase()) {
        ctx.addIssue({ code: "custom", path: ["TEST_DATABASE_URL"] });
      }
    }
    if (testDb && NON_TEST_DB_PATTERN.test(testDb)) {
      ctx.addIssue({ code: "custom", path: ["TEST_DATABASE_URL"] });
    }

    // AI_ENABLED=true 时才要求 AI 凭证。
    if (value.AI_ENABLED) {
      if (!value.AI_PROVIDER.trim()) ctx.addIssue({ code: "custom", path: ["AI_PROVIDER"] });
      if (!value.AI_MODEL.trim()) ctx.addIssue({ code: "custom", path: ["AI_MODEL"] });
      if (!value.AI_API_KEY.trim()) ctx.addIssue({ code: "custom", path: ["AI_API_KEY"] });
    }
  });

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export type OrbitEnv = z.infer<typeof envSchema>;

/** 校验错误：仅携带「变量名 + 预期格式」的可读列表，绝不含变量值。 */
export class EnvValidationError extends Error {
  readonly issues: ReadonlyArray<{ key: string; expected: string }>;
  constructor(issues: ReadonlyArray<{ key: string; expected: string }>) {
    const lines = issues.map((i) => `  - ${i.key}: ${i.expected}`).join("\n");
    super(`环境变量校验失败（仅显示变量名与预期格式，不回显值）：\n${lines}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/**
 * 断言没有任何秘密/凭证类变量被 NEXT_PUBLIC_ 前缀暴露。
 * 返回违规的变量名列表（不返回值）。
 */
export function findPublicSecretViolations(
  raw: Record<string, string | undefined>,
): string[] {
  const violations: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!key.startsWith("NEXT_PUBLIC_")) continue;
    const bare = key.slice("NEXT_PUBLIC_".length);
    if ((SECRET_KEYS as readonly string[]).includes(bare) || SECRET_HINT.test(bare)) {
      violations.push(key);
    }
  }
  return violations.sort();
}

/**
 * 解析并校验一份环境变量集合（纯函数，便于单元测试）。
 * 失败时抛出 EnvValidationError，错误内容只含变量名与预期格式。
 */
export function parseEnv(raw: Record<string, string | undefined>): OrbitEnv {
  const publicSecrets = findPublicSecretViolations(raw);
  if (publicSecrets.length > 0) {
    throw new EnvValidationError(
      publicSecrets.map((key) => ({
        key,
        expected: "秘密/凭证类变量禁止使用 NEXT_PUBLIC_ 前缀（会进入客户端 bundle）",
      })),
    );
  }

  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const seen = new Set<string>();
    const issues: Array<{ key: string; expected: string }> = [];
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? "(unknown)");
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({ key, expected: EXPECTED_FORMAT[key] ?? "格式不正确" });
    }
    throw new EnvValidationError(issues);
  }
  return result.data;
}

let cached: OrbitEnv | undefined;

/**
 * 校验真实的 process.env（服务启动期调用）。结果缓存，避免重复解析。
 * 传入 force=true 可强制重新校验（测试用）。
 */
export function getEnv(force = false): OrbitEnv {
  if (cached && !force) return cached;
  cached = parseEnv(process.env as Record<string, string | undefined>);
  return cached;
}
