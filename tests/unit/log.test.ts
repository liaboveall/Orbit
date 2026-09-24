import { afterEach, expect, test, vi } from "vitest";
import { logEvent } from "@/server/http/log";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
test("LOG_LEVEL filters informational events while retaining structured errors", () => {
  vi.stubEnv("LOG_LEVEL", "error");
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  logEvent("info", { event: "auth_email_sent" });
  logEvent("error", { errorCode: "SERVICE_UNAVAILABLE" });
  expect(info).not.toHaveBeenCalled();
  expect(JSON.parse(error.mock.calls[0]![0] as string)).toEqual({ level: "error", errorCode: "SERVICE_UNAVAILABLE" });
});
