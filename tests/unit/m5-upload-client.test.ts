import { afterEach, expect, it, vi } from "vitest";
import { uploadAttachment } from "@/features/tasks/api-helpers";
import { uploadFilePart } from "@/features/tasks/attachments/types";
import { dateInTimezone } from "@/lib/calendar";
afterEach(() => vi.unstubAllGlobals());
it("cancelled during hashing never creates or sends an upload request", async () => {
  const constructor = vi.fn();
  vi.stubGlobal("XMLHttpRequest", constructor);
  const controller = new AbortController();
  controller.abort();
  await expect(
    uploadAttachment("task", new FormData(), { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(constructor).not.toHaveBeenCalled();
});
it("unknown browser MIME preserves exact Markdown bytes with a supported file part", async () => {
  const file = new File(["# 内容\n正文"], "说明.md");
  const part = uploadFilePart(file);
  expect(part.type).toBe("text/markdown");
  expect(await part.text()).toBe(await file.text());
  const declared = new File(["bytes"], "invalid.txt", {
    type: "application/x-executable",
  });
  expect(uploadFilePart(declared)).toBe(declared);
});
it("dateInTimezone uses the supplied instant across local midnight", () => {
  const instant = new Date("2026-09-11T16:30:00Z");
  expect(dateInTimezone("Asia/Shanghai", instant)).toBe("2026-09-12");
  expect(dateInTimezone("America/Los_Angeles", instant)).toBe("2026-09-11");
});
