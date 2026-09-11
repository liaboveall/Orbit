import { expect, test, vi } from "vitest";
import { toErrorResponse, DomainError } from "@/server/http/errors";

test("database outages return a redacted 503 and rate limits provide retry guidance", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const response = toErrorResponse({ code: "P1001", message: "postgresql://private:secret@host/database" }, "m6-request");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    expect(toErrorResponse(new DomainError("RATE_LIMITED", "稍后重试"), "m6-request").headers.get("Retry-After")).toBe("60");
  } finally { log.mockRestore(); }
});
