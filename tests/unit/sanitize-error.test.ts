import { describe, expect, it } from "vitest";
import { sanitizeErrorForLog } from "@/server/http/sanitize-error";

/**
 * R4 安全修复测试：错误日志脱敏
 * 
 * 验证所有可能包含敏感信息的字段都被完全移除，只保留安全的errorCode/errorClass/requestId。
 */
describe("sanitizeErrorForLog", () => {
  it("完全移除 Error.message 中的敏感信息", () => {
    const sensitiveMessages = [
      "password=secret123&token=abc",
      "connection_string=postgres://user:pass@host/db",
      "api_key=sk-1234567890abcdef",
      "cookie=sessionid%3Dabcd1234",
      "signed_url=https://example.com?token=xyz",
    ];

    for (const msg of sensitiveMessages) {
      const err = new Error(msg);
      const sanitized = sanitizeErrorForLog(err, "req-test-1");

      // 确认 message 被完全移除（不出现在任何字段值中）
      expect(JSON.stringify(sanitized)).not.toContain(
        msg.replace(/=/g, "=").replace(/ /g, " ") // 保持原始格式
      );
      expect(JSON.stringify(sanitized)).not.toContain("secret123");
      expect(JSON.stringify(sanitized)).not.toContain("pass@host");
      expect(JSON.stringify(sanitized)).not.toContain("sk-1234567890");
    }
  });

  it("完全移除 Error.name 中的敏感信息", () => {
    class CustomError extends Error {
      constructor(name: string, message: string) {
        super(message);
        this.name = name;
      }
    }

    const sensitiveNames = ["TokenValidationError", "PasswordResetError", "APIKeyExpired"];
    
    for (const name of sensitiveNames) {
      const err = new CustomError(name, "Some error occurred");
      const sanitized = sanitizeErrorForLog(err, "req-test-2");

      // errorClass 应该是去除 "Error" 后缀的纯类名，但不应暴露具体 token/password/apikey 等上下文
      const errorMsg = JSON.stringify(sanitized);
      
      // 关键：不能泄露具体业务语义
      expect(errorMsg.toLowerCase()).not.toContain("token".toLowerCase());
      expect(errorMsg.toLowerCase()).not.toContain("password".toLowerCase());
      expect(errorMsg.toLowerCase()).not.toContain("apikey".toLowerCase());
      expect(errorMsg.toLowerCase()).not.toContain("expired".toLowerCase());
    }
  });

  it("完全移除 stack 轨迹信息", () => {
    const err = new Error("test error");
    const sanitized = sanitizeErrorForLog(err, "req-test-3");

    // Stack 应该完全不出现
    expect(sanitized).not.toHaveProperty("stack");
    expect(JSON.stringify(sanitized)).not.toContain("/src/");
    expect(JSON.stringify(sanitized)).not.toContain(".ts:");
    expect(JSON.stringify(sanitized)).not.toContain("at ");
  });

  it("正确提取并保留 errorCode", () => {
    const err = new Error("Internal failure");
    type CustomErrorWithCode = Error & { code?: string };

    (err as CustomErrorWithCode).code = "VERSION_CONFLICT";

    const sanitized = sanitizeErrorForLog(err, "req-test-4");

    expect(sanitized.errorCode).toBe("VERSION_CONFLICT");
    expect(sanitized.requestId).toBe("req-test-4");
  });

  it("不记录 undefined 的 errorCode", () => {
    const err = new Error("Not a version conflict");
    const sanitized = sanitizeErrorForLog(err, "req-test-5");

    expect(sanitized.errorCode).toBeUndefined();
    expect(Object.keys(sanitized).filter((k) => k === "errorCode")).toHaveLength(0);
  });

  it("正确提取 errorClass（去掉 'Error' 后缀）", () => {
    const err = new TypeError("Type mismatch");
    const sanitized = sanitizeErrorForLog(err, "req-test-6");

    expect(sanitized.errorClass).toBe("Type");
  });

  it("普通 Error 返回 Unknown", () => {
    const err = new Error("Generic error");
    const sanitized = sanitizeErrorForLog(err, "req-test-7");

    // Error 类本身被去掉了，应该变成 'Unknown'
    expect(sanitized.errorClass).toBe("Unknown");
  });

  it("未知类型处理", () => {
    const err = new Error("Message without code");
    const sanitized = sanitizeErrorForLog(err, "req-test-8");

    expect(sanitized.requestId).toBe("req-test-8");
    expect(typeof sanitized.errorClass).toBe("string");
  });

  it("处理非 Error 对象：string", () => {
    const err = "plain string error";
    const sanitized = sanitizeErrorForLog(err, "req-test-9");

    expect(sanitized.requestId).toBe("req-test-9");
    expect(sanitized.errorClass).toBe("string");
  });

  it("处理非 Error 对象：number", () => {
    const err = 42;
    const sanitized = sanitizeErrorForLog(err, "req-test-10");

    expect(sanitized.requestId).toBe("req-test-10");
    expect(sanitized.errorClass).toBe("number");
  });

  it("处理非 Error 对象：object", () => {
    const err = { code: "SYNTHETIC_SECRET_123", message: "synthetic object" };
    const sanitized = sanitizeErrorForLog(err, "req-test-11");

    expect(sanitized.requestId).toBe("req-test-11");
    expect(sanitized.errorClass).toBe("object");
    
    // 关键：即使原对象含 secret，也不能出现在日志中
    expect(JSON.stringify(sanitized)).not.toContain("SYNTHETIC_SECRET_123");
    expect(JSON.stringify(sanitized)).not.toContain("synthetic");
  });

  it("处理 non-DomainError 的自定义错误类", () => {
    class NetworkError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "NetworkError";
      }
    }

    const err = new NetworkError("Connection refused");
    type CustomErrorWithCode = typeof err & { code?: string };

    (err as CustomErrorWithCode).code = "NETWORK_ERROR";

    const sanitized = sanitizeErrorForLog(err, "req-test-12");

    expect(sanitized.errorCode).toBe("NETWORK_ERROR");
    expect(sanitized.errorClass).toBe("Network"); // 去掉 Error 后缀
    expect(JSON.stringify(sanitized)).not.toContain("Connection refused");
  });

  it("没有 requestId 时不记录 requestId 字段", () => {
    const err = new Error("Error without request context");
    type CustomErrorWithCode = Error & { code?: string };

    (err as CustomErrorWithCode).code = "INTERNAL_ERROR";

    const sanitized = sanitizeErrorForLog(err);

    expect(sanitized).not.toHaveProperty("requestId");
    expect(sanitized.errorCode).toBe("INTERNAL_ERROR");
    expect(sanitized.errorClass).toBe("Unknown");
  });

  it("验证完整的脱敏效果 - 合成秘密场景", () => {
    const syntheticSecrets = [
      "SYNTHETIC_SECRET_123",
      "password=SecretPass123!",
      "token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      "api_secret=xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOp",
    ];

    for (const secret of syntheticSecrets) {
      const err = new Error(secret);
      const sanitized = sanitizeErrorForLog(err, "req-security-test");

      // 所有合成秘密都不能出现在序列化后的日志中
      expect(JSON.stringify(sanitized)).not.toContain(secret);
    }
  });

  it("验证字段白名单策略", () => {
    const err = new Error("Should be fully sanitized");
    type CustomErrorWithCode = Error & { code?: string; customField?: string };

    (err as CustomErrorWithCode).code = "VALIDATION_ERROR";
    (err as CustomErrorWithCode).customField = "should not appear";

    const sanitized = sanitizeErrorForLog(err, "req-whitelist");

    // 只应该有这些字段（requestId 可选，errorCode 和 errorClass 是核心）
    const allowedKeys = ["requestId", "errorCode", "errorClass"];
    const actualKeys = Object.keys(sanitized);

    for (const key of actualKeys) {
      expect(allowedKeys).toContain(key);
    }

    // 验证 customField 没有被泄露
    expect(sanitized).not.toHaveProperty("customField");
    expect(JSON.stringify(sanitized)).not.toContain("should not appear");
  });

  it("复杂敏感数据混合场景", () => {
    const complexError = new Error(
      "Auth failed: user=john&password=P@ssw0rd123!&token=abc-xyz-123&session=abcd1234efgh5678"
    );
    type CustomErrorWithCode = typeof complexError & { code?: string };

    (complexError as CustomErrorWithCode).code = "AUTH_FAILURE";

    const sanitized = sanitizeErrorForLog(complexError, "req-complex");

    expect(sanitized.errorCode).toBe("AUTH_FAILURE");
    expect(sanitized.requestId).toBe("req-complex");

    const logOutput = JSON.stringify(sanitized);

    // 所有敏感信息必须被完全移除
    expect(logOutput).not.toContain("john");
    expect(logOutput).not.toContain("P@ssw0rd123");
    expect(logOutput).not.toContain("abc-xyz-123");
    expect(logOutput).not.toContain("abcd1234efgh5678");
    expect(logOutput).not.toContain("Auth failed");
    expect(logOutput).not.toContain("Auth");
    expect(logOutput).not.toContain("failed");
  });
});
