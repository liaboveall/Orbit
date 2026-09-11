import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 契约测试骨架（M0）。
 *
 * ORB-003 会在此扩展请求/响应 DTO、错误码与 Zod ↔ OpenAPI 对照。
 * M0 阶段先做真实断言：contracts/openapi.json 可解析且顶层结构与 docs/05 一致，
 * 保证后续契约测试有可信基线（非 exit 0 空脚本）。
 */
const openApiPath = fileURLToPath(new URL("../../contracts/openapi.json", import.meta.url));

type OpenApiDoc = {
  openapi: string;
  info: { title: string; version: string };
  servers: Array<{ url: string }>;
  tags: Array<{ name: string }>;
  paths: Record<string, unknown>;
};

function loadDoc(): OpenApiDoc {
  const raw = readFileSync(openApiPath, "utf8");
  return JSON.parse(raw) as OpenApiDoc;
}

describe("contracts/openapi.json 结构骨架", () => {
  const doc = loadDoc();

  it("是合法的 OpenAPI 3.1 文档", () => {
    expect(doc.openapi).toBe("3.1.0");
  });

  it("info 标题与版本符合 Orbit V1 业务 API", () => {
    expect(doc.info.title).toBe("Orbit V1 Business API");
    expect(doc.info.version).toBe("1.0.0");
  });

  it("业务 API 挂在 /api/v1（认证由 Better Auth 的 /api/auth/* 管理，不在此契约）", () => {
    expect(doc.servers).toHaveLength(1);
    expect(doc.servers[0]?.url).toBe("/api/v1");
  });

  it("声明了业务领域 tags", () => {
    const tagNames = doc.tags.map((t) => t.name);
    for (const expected of ["Projects", "Tasks", "Board", "Comments", "Files", "Activity"]) {
      expect(tagNames).toContain(expected);
    }
  });

  it("paths 为对象且至少定义了一条业务路径", () => {
    expect(typeof doc.paths).toBe("object");
    expect(Object.keys(doc.paths).length).toBeGreaterThan(0);
  });
});
