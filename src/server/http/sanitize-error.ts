import "server-only";
import { ErrorCodeSchema } from "@/contracts";
/** Do not derive log fields from arbitrary constructor/name/message/stack text. */
export function sanitizeErrorForLog(error: unknown, requestId?: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (requestId && /^[A-Za-z0-9_-]{1,128}$/.test(requestId)) result.requestId = requestId;
  result.errorClass = error instanceof TypeError ? "Type" : error instanceof RangeError ? "Range"
    : error instanceof SyntaxError ? "Syntax" : error instanceof Error ? "Unknown" : typeof error;
  if (error instanceof Error) {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    const parsed = ErrorCodeSchema.safeParse(descriptor?.value);
    if (parsed.success) result.errorCode = parsed.data;
  }
  return result;
}
