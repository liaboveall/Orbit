import { expect, test } from "vitest";
import { cn } from "@/lib/cn";
test("custom typography preserves explicit foreground contrast while allowing size overrides", () => {
  expect(cn("text-foreground-invert", "text-label")).toBe("text-foreground-invert text-label");
  expect(cn("text-label", "text-body")).toBe("text-body");
});
