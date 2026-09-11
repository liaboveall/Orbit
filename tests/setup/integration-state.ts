import { afterEach } from "vitest";
import dotenv from "dotenv";
import { parseEnv, getEnv } from "@/server/env";
import { RateLimiterFactory } from "@/server/modules/rate-limit";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
const env = parseEnv(process.env as Record<string, string | undefined>);
const target = new URL(env.TEST_DATABASE_URL);
if (!/(^|[_-])test([_-]|$)/i.test(target.pathname.slice(1))) {
  throw new Error("Integration tests require an explicitly named test database");
}
process.env.APP_ENV = "test";
process.env.DATABASE_URL = env.TEST_DATABASE_URL;
getEnv(true);
// Each test starts a new quota window; its own sequence still exercises real limits.
afterEach(() => RateLimiterFactory.resetInstance());
