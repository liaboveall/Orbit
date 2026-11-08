import { expect, test } from "vitest";
import { assessPasswordStrength, PASSWORD_MAX } from "@/features/auth/validation";
import { cn } from "@/lib/cn";

test("custom typography preserves explicit foreground contrast while allowing size overrides", () => {
  expect(cn("text-foreground-invert", "text-label")).toBe("text-foreground-invert text-label");
  expect(cn("text-label", "text-body")).toBe("text-body");
});

test("assessPasswordStrength rejects passwords exceeding PASSWORD_MAX instead of scoring strong", () => {
  expect(assessPasswordStrength("Aa1!" + "a".repeat(PASSWORD_MAX))).toEqual({
    score: 1,
    label: `不超过 ${PASSWORD_MAX} 个字符`,
    tone: "text-danger",
  });
});
