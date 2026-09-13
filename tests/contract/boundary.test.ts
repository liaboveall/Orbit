import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 服务端 / 客户端边界测试（ORB-003）。
 *
 * 契约层（src/contracts）必须能进入浏览器 bundle：不得出现任何服务端依赖
 * （server-only / @prisma/client / @/server / @/generated）。反之 src/server 下每个
 * 模块必须以 `import "server-only"` 保护，防止被误引入客户端（AGENTS.md、docs/03 §3/§5）。
 *
 * 检测基于「带引号的模块说明符 / import 语句」而非裸子串，避免把注释中的
 * 文字（如「无 server-only 依赖」）误判为违规。
 */

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const contractsDir = join(repoRoot, "src", "contracts");
const serverDir = join(repoRoot, "src", "server");

/** 递归收集目录下所有 .ts/.tsx 文件（忽略 README 等非源码）。
 *  F33②：纳入 .tsx——服务端目录未来出现 .tsx（如错误页/邮件模板）时，
 *  server-only 守卫同样必须覆盖，不允许 .tsx 逃逸扫描。 */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      out.push(full);
    }
  }
  return out.sort();
}

/** 契约层禁止出现的服务端依赖（以带引号的模块说明符匹配）。 */
const FORBIDDEN_IN_CONTRACTS: Array<{ label: string; pattern: RegExp }> = [
  { label: "server-only", pattern: /["']server-only["']/ },
  { label: "@prisma/client", pattern: /["']@prisma\/client["']/ },
  { label: "@/server", pattern: /["']@\/server(?:\/|["'])/ },
  { label: "@/generated", pattern: /["']@\/generated(?:\/|["'])/ },
  { label: "相对路径 ../server", pattern: /["']\.\.?\/[^"']*server[^"']*["']/ },
];

/** server-only 保护语句（行首 import）。 */
const SERVER_ONLY_IMPORT = /^\s*import\s+["']server-only["']/m;

describe("src/contracts 无服务端依赖（可进客户端 bundle）", () => {
  const files = collectTsFiles(contractsDir);

  it("契约层至少包含本次交付的核心模块", () => {
    const names = files.map((f) => f.split(/[\\/]/).pop());
    for (const expected of [
      "index.ts",
      "primitives.ts",
      "enums.ts",
      "error-codes.ts",
      "envelope.ts",
      "dto.ts",
      "helpers.ts",
      "client.ts",
    ]) {
      expect(names, `缺少 ${expected}`).toContain(expected);
    }
  });

  it("任何契约文件都不得引用服务端依赖", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const { label, pattern } of FORBIDDEN_IN_CONTRACTS) {
        expect(pattern.test(source), `${file} 违规引用 ${label}`).toBe(false);
      }
    }
  });

  it("契约文件只从 zod 与同层相对模块导入（无跨层服务端导入）", () => {
    const externalImport = /^\s*import\s+[^;]*?from\s+["']([^"'.][^"']*)["']/gm;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(externalImport)) {
        const specifier = match[1];
        // 唯一允许的外部包是 zod；其余外部说明符一律视为越界。
        expect(specifier, `${file} 引入了外部包 ${specifier}`).toBe("zod");
      }
    }
  });
});

describe("src/server 全部模块受 server-only 保护", () => {
  const files = collectTsFiles(serverDir);

  it("server 目录下存在源码文件", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("每个 server .ts 文件都以 import \"server-only\" 开头保护", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(SERVER_ONLY_IMPORT.test(source), `${file} 缺少 server-only 保护`).toBe(true);
    }
  });
});
