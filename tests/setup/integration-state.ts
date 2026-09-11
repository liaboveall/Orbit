import { afterEach } from "vitest";
import { RateLimiterFactory } from "@/server/modules/rate-limit";
// Each test starts a new quota window; its own sequence still exercises real limits.
afterEach(() => RateLimiterFactory.resetInstance());
