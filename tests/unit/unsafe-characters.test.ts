import { describe, expect, it } from "vitest";
import { hasUnsafeDisplayCharacters } from "@/server/modules/unsafe-characters";
import { requireUserNameRejectedReason } from "@/server/auth/user-fields";
import { validateFileNameType } from "@/server/modules/attachments/file-validation";

describe("不可见/方向控制字符（姓名与附件文件名同一口径）", () => {
  it("拒绝 bidi 覆盖/隔离符与非空白控制字符", () => {
    for (const value of ["a‮b", "a‪b", "a⁦b", "a⁩b", "a\u0000b", "a\u0008b", "a\u007Fb", "a\u0085b", "a\u009Fb"]) {
      expect(hasUnsafeDisplayCharacters(value)).toBe(true);
    }
  });

  it("保留中文、组合字符、emoji 与常规空白", () => {
    for (const value of ["张三", "école", "团队🚀", "tab\there", "line\nbreak"]) {
      expect(hasUnsafeDisplayCharacters(value)).toBe(false);
    }
  });

  it("姓名规则沿用同一判定", () => {
    expect(requireUserNameRejectedReason("张‮三")).toContain("不可见字符");
    expect(requireUserNameRejectedReason("张三")).toBeNull();
  });

  it("附件文件名拒绝伪装扩展名的方向控制字符与 C1 控制字符", () => {
    expect(() => validateFileNameType("photo‮gnp.txt", "text/plain")).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_FILE_TYPE" }),
    );
    expect(() => validateFileNameType("report\u0085.pdf", "application/pdf")).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_FILE_TYPE" }),
    );
    expect(() => validateFileNameType("dir/report.pdf", "application/pdf")).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_FILE_TYPE" }),
    );
    expect(() => validateFileNameType("课程报告 v2.pdf", "application/pdf")).not.toThrow();
    expect(() => validateFileNameType("笔记.md", "text/markdown")).not.toThrow();
  });
});
