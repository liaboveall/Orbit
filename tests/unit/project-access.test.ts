import { describe, expect, it } from "vitest";
import {
  decideProjectAccess,
  decideProjectWrite,
} from "@/server/modules/authorization/decide";

/**
 * 授权纯判定函数单元测试（M2 / ORB-007，docs/01 §4 权限矩阵、docs/03 §5）。
 *
 * decide.ts 无 IO，可穷举全分支：读访问角色判定 + 写访问判定。
 * 核心不变量：非成员与不存在统一收敛为 NOT_FOUND（不泄露项目是否存在）。
 */

describe("decideProjectAccess — 读访问角色判定", () => {
  it("项目不存在 → NOT_FOUND（即使传入 isOwner/isMember 也以下不存在为准）", () => {
    expect(decideProjectAccess({ exists: false, isOwner: false, isMember: false })).toBe(
      "NOT_FOUND",
    );
    expect(decideProjectAccess({ exists: false, isOwner: true, isMember: true })).toBe(
      "NOT_FOUND",
    );
  });

  it("owner → OWNER", () => {
    expect(decideProjectAccess({ exists: true, isOwner: true, isMember: false })).toBe("OWNER");
  });

  it("owner 优先于 member（同时命中时判为 OWNER）", () => {
    expect(decideProjectAccess({ exists: true, isOwner: true, isMember: true })).toBe("OWNER");
  });

  it("非 owner 成员 → MEMBER", () => {
    expect(decideProjectAccess({ exists: true, isOwner: false, isMember: true })).toBe("MEMBER");
  });

  it("项目存在但既非 owner 也非成员 → NOT_FOUND（不可见收敛为不存在）", () => {
    expect(decideProjectAccess({ exists: true, isOwner: false, isMember: false })).toBe(
      "NOT_FOUND",
    );
  });
});

describe("decideProjectWrite — 写访问判定", () => {
  const active = null;
  const archived = new Date("2026-01-01T00:00:00.000Z");

  it("owner 对未归档项目的 update/archive → ALLOWED", () => {
    expect(decideProjectWrite({ role: "OWNER", archivedAt: active, action: "update" })).toBe(
      "ALLOWED",
    );
    expect(decideProjectWrite({ role: "OWNER", archivedAt: active, action: "archive" })).toBe(
      "ALLOWED",
    );
  });

  it("member 做任意写操作 → FORBIDDEN（owner-only）", () => {
    expect(decideProjectWrite({ role: "MEMBER", archivedAt: active, action: "update" })).toBe(
      "FORBIDDEN",
    );
    expect(decideProjectWrite({ role: "MEMBER", archivedAt: active, action: "archive" })).toBe(
      "FORBIDDEN",
    );
    expect(decideProjectWrite({ role: "MEMBER", archivedAt: archived, action: "restore" })).toBe(
      "FORBIDDEN",
    );
  });

  it("member 判定优先于归档态（先 FORBIDDEN，不泄露归档信息）", () => {
    expect(decideProjectWrite({ role: "MEMBER", archivedAt: archived, action: "update" })).toBe(
      "FORBIDDEN",
    );
  });

  it("owner 对归档项目 update/archive → ARCHIVED（只读）", () => {
    expect(decideProjectWrite({ role: "OWNER", archivedAt: archived, action: "update" })).toBe(
      "ARCHIVED",
    );
    expect(decideProjectWrite({ role: "OWNER", archivedAt: archived, action: "archive" })).toBe(
      "ARCHIVED",
    );
  });

  it("owner 对归档项目 restore → ALLOWED（唯一例外）", () => {
    expect(decideProjectWrite({ role: "OWNER", archivedAt: archived, action: "restore" })).toBe(
      "ALLOWED",
    );
  });

  it("owner 对未归档项目 restore（无状态变化的幂等恢复）→ ALLOWED", () => {
    expect(decideProjectWrite({ role: "OWNER", archivedAt: active, action: "restore" })).toBe(
      "ALLOWED",
    );
  });
});
