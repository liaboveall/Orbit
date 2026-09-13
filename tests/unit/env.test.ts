import { describe, expect, it } from "vitest";
import {
  EnvValidationError,
  findPublicSecretViolations,
  parseEnv,
} from "@/server/env";

/** 与 .env.example 对齐的合法开发环境样本。 */
function validEnv(): Record<string, string> {
  return {
    APP_ENV: "development",
    APP_URL: "http://localhost:3000",
    DATABASE_URL: "postgresql://orbit:orbit_dev_only@localhost:5432/orbit_dev",
    TEST_DATABASE_URL: "postgresql://orbit:orbit_dev_only@localhost:5432/orbit_test",
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "",
    AUTH_TRUSTED_ORIGINS: "http://localhost:3000",
    SMTP_HOST: "localhost",
    SMTP_PORT: "1025",
    SMTP_USER: "",
    SMTP_PASSWORD: "",
    SMTP_SECURE: "false",
    MAIL_FROM: "Orbit <no-reply@orbit.local>",
    STORAGE_ENDPOINT: "http://localhost:9000",
    STORAGE_REGION: "us-east-1",
    STORAGE_BUCKET: "orbit-dev",
    STORAGE_ACCESS_KEY_ID: "orbit_dev_access",
    STORAGE_SECRET_ACCESS_KEY: "orbit_dev_secret_change",
    STORAGE_FORCE_PATH_STYLE: "true",
    LOG_LEVEL: "debug",
    AI_ENABLED: "false",
    AI_PROVIDER: "",
    AI_MODEL: "",
    AI_API_KEY: "",
    AI_DAILY_REQUEST_LIMIT: "10",
  };
}

function captureIssues(fn: () => unknown): { key: string; expected: string; message: string } {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    const err = error as EnvValidationError;
    return {
      key: err.issues[0]?.key ?? "",
      expected: err.issues[0]?.expected ?? "",
      message: err.message,
    };
  }
  throw new Error("期望抛出 EnvValidationError，但没有抛出");
}

describe("parseEnv · 合法输入", () => {
  it("接受与 .env.example 对齐的开发环境", () => {
    const env = parseEnv(validEnv());
    expect(env.APP_ENV).toBe("development");
    expect(env.SMTP_PORT).toBe(1025);
    expect(env.STORAGE_FORCE_PATH_STYLE).toBe(true);
    expect(env.AI_ENABLED).toBe(false);
    expect(env.AI_DAILY_REQUEST_LIMIT).toBe(10);
  });

  it("AI_ENABLED=false 时不要求任何 AI_* 凭证", () => {
    const raw = validEnv();
    delete raw.AI_PROVIDER;
    delete raw.AI_MODEL;
    delete raw.AI_API_KEY;
    expect(() => parseEnv(raw)).not.toThrow();
  });

  it("production 下提供足够长度的 BETTER_AUTH_SECRET 时通过", () => {
    const raw = { ...validEnv(), APP_ENV: "production", APP_URL: "https://orbit.example", BETTER_AUTH_URL: "https://orbit.example", STORAGE_ENDPOINT: "https://storage.example", BETTER_AUTH_SECRET: "x".repeat(48), TRUSTED_PROXY_COUNT: "1" };
    expect(() => parseEnv(raw)).not.toThrow();
  });

  it("D1：production 且 TRUSTED_PROXY_COUNT=0 被拒绝（限流塌缩为全局单桶的误配）", () => {
    const raw = {
      ...validEnv(),
      APP_ENV: "production",
      APP_URL: "https://orbit.example",
      BETTER_AUTH_URL: "https://orbit.example",
      STORAGE_ENDPOINT: "https://storage.example",
      BETTER_AUTH_SECRET: "x".repeat(48),
      TRUSTED_PROXY_COUNT: "0",
    };
    const { key, expected } = captureIssues(() => parseEnv(raw));
    expect(key).toBe("TRUSTED_PROXY_COUNT");
    expect(expected).toContain("production 环境必须 ≥ 1");
  });

  it("D1：production 且 TRUSTED_PROXY_COUNT=1 通过；development 默认 0 仍通过", () => {
    expect(
      () =>
        parseEnv({
          ...validEnv(),
          APP_ENV: "production",
          APP_URL: "https://orbit.example",
          BETTER_AUTH_URL: "https://orbit.example",
          STORAGE_ENDPOINT: "https://storage.example",
          BETTER_AUTH_SECRET: "x".repeat(48),
          TRUSTED_PROXY_COUNT: "1",
        }),
    ).not.toThrow();
    expect(() => parseEnv(validEnv())).not.toThrow();
  });
});

describe("parseEnv · 必需项与枚举", () => {
  it("缺失 APP_ENV 时失败，并指出变量名", () => {
    const raw = validEnv();
    delete raw.APP_ENV;
    const { key } = captureIssues(() => parseEnv(raw));
    expect(key).toBe("APP_ENV");
  });

  it("非法 APP_ENV 枚举被拒绝", () => {
    const { key } = captureIssues(() => parseEnv({ ...validEnv(), APP_ENV: "qa" }));
    expect(key).toBe("APP_ENV");
  });

  it("非 development 环境缺失 BETTER_AUTH_SECRET 被拒绝", () => {
    const { key } = captureIssues(() =>
      parseEnv({ ...validEnv(), APP_ENV: "production", BETTER_AUTH_SECRET: "" }),
    );
    expect(key).toBe("BETTER_AUTH_SECRET");
  });

  it("AI_ENABLED=true 时缺失 AI_API_KEY 被拒绝", () => {
    const raw = { ...validEnv(), AI_ENABLED: "true", AI_PROVIDER: "p", AI_MODEL: "m", AI_API_KEY: "" };
    const { key } = captureIssues(() => parseEnv(raw));
    expect(key).toBe("AI_API_KEY");
  });

  it("AUTH_TRUSTED_ORIGINS 含通配符 * 被拒绝", () => {
    const { key } = captureIssues(() =>
      parseEnv({ ...validEnv(), AUTH_TRUSTED_ORIGINS: "*" }),
    );
    expect(key).toBe("AUTH_TRUSTED_ORIGINS");
  });
});

describe("parseEnv · 测试库隔离", () => {
  it("TEST_DATABASE_URL 与开发库同名被拒绝", () => {
    const { key } = captureIssues(() =>
      parseEnv({
        ...validEnv(),
        TEST_DATABASE_URL: "postgresql://orbit:orbit_dev_only@localhost:5432/orbit_dev",
      }),
    );
    expect(key).toBe("TEST_DATABASE_URL");
  });

  it("TEST_DATABASE_URL 指向生产库名被拒绝", () => {
    const { key } = captureIssues(() =>
      parseEnv({
        ...validEnv(),
        TEST_DATABASE_URL: "postgresql://orbit:orbit_dev_only@localhost:5432/orbit_production",
      }),
    );
    expect(key).toBe("TEST_DATABASE_URL");
  });

  /**
   * A10 修复：scripts/e2e-server.mjs 会把子进程的 DATABASE_URL 显式覆写为
   * TEST_DATABASE_URL 的完整连接串（逐字节相同），让 E2E 测试服务器全程连接独立
   * 测试库。这不该被「测试库不得与开发库同名」的规则误伤——但豁免条件必须窄：
   * 只有 APP_ENV=test **且**两值逐字节相同才放行，其它任何形状仍按原规则拒绝。
   */
  it("APP_ENV=test 且 DATABASE_URL 与 TEST_DATABASE_URL 逐字节相同时放行（E2E 测试服务器场景）", () => {
    const testUrl = "postgresql://orbit:orbit_dev_only@localhost:5432/orbit_test";
    const env = parseEnv({
      ...validEnv(),
      APP_ENV: "test",
      BETTER_AUTH_SECRET: "x".repeat(48),
      DATABASE_URL: testUrl,
      TEST_DATABASE_URL: testUrl,
    });
    expect(env.DATABASE_URL).toBe(testUrl);
    expect(env.TEST_DATABASE_URL).toBe(testUrl);
  });

  it("APP_ENV=development 即使两值逐字节相同也仍被拒绝（豁免只对 test 生效）", () => {
    const testUrl = "postgresql://orbit:orbit_dev_only@localhost:5432/orbit_test";
    const { key } = captureIssues(() =>
      parseEnv({
        ...validEnv(),
        APP_ENV: "development",
        DATABASE_URL: testUrl,
        TEST_DATABASE_URL: testUrl,
      }),
    );
    expect(key).toBe("TEST_DATABASE_URL");
  });

  it("APP_ENV=test 但两值仅数据库名相同、连接串其它部分不同时仍被拒绝（豁免要求逐字节相同）", () => {
    const { key } = captureIssues(() =>
      parseEnv({
        ...validEnv(),
        APP_ENV: "test",
        BETTER_AUTH_SECRET: "x".repeat(48),
        DATABASE_URL: "postgresql://orbit:orbit_dev_only@localhost:5432/orbit_test",
        TEST_DATABASE_URL: "postgresql://someone-else:different-pass@localhost:5432/orbit_test",
      }),
    );
    expect(key).toBe("TEST_DATABASE_URL");
  });

  it("APP_ENV=test 且逐字节相同时，TEST_DATABASE_URL 仍不得命中开发/生产库名黑名单", () => {
    const prodLikeUrl = "postgresql://orbit:orbit_dev_only@localhost:5432/orbit_production";
    const { key } = captureIssues(() =>
      parseEnv({
        ...validEnv(),
        APP_ENV: "test",
        BETTER_AUTH_SECRET: "x".repeat(48),
        DATABASE_URL: prodLikeUrl,
        TEST_DATABASE_URL: prodLikeUrl,
      }),
    );
    expect(key).toBe("TEST_DATABASE_URL");
  });
});

describe("秘密不得进入客户端", () => {
  it("findPublicSecretViolations 标记 NEXT_PUBLIC_ 前缀的秘密变量", () => {
    const violations = findPublicSecretViolations({
      NEXT_PUBLIC_DATABASE_URL: "postgresql://x",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_SMTP_PASSWORD: "leak",
    });
    expect(violations).toContain("NEXT_PUBLIC_DATABASE_URL");
    expect(violations).toContain("NEXT_PUBLIC_SMTP_PASSWORD");
    // APP_URL 非秘密，不应被标记
    expect(violations).not.toContain("NEXT_PUBLIC_APP_URL");
  });

  it("parseEnv 在存在 NEXT_PUBLIC 秘密时直接拒绝", () => {
    const { key } = captureIssues(() =>
      parseEnv({ ...validEnv(), NEXT_PUBLIC_STORAGE_SECRET_ACCESS_KEY: "leak" }),
    );
    expect(key).toBe("NEXT_PUBLIC_STORAGE_SECRET_ACCESS_KEY");
  });
});

describe("错误信息不回显变量值", () => {
  it("失败信息只含变量名与预期格式，不含秘密值", () => {
    const secret = "SUPER-SECRET-VALUE-9f3a";
    const raw = {
      ...validEnv(),
      APP_ENV: "production",
      BETTER_AUTH_SECRET: secret, // 长度不足 32，触发校验失败
    };
    const { message, key } = captureIssues(() => parseEnv(raw));
    expect(key).toBe("BETTER_AUTH_SECRET");
    expect(message).not.toContain(secret);
    expect(message).toContain("BETTER_AUTH_SECRET");
  });

  it("非法连接串失败时不回显连接串内容", () => {
    const raw = { ...validEnv(), DATABASE_URL: "mysql://user:pass@host/db" };
    const { message } = captureIssues(() => parseEnv(raw));
    expect(message).not.toContain("mysql://user:pass@host/db");
    expect(message).toContain("DATABASE_URL");
  });
});
