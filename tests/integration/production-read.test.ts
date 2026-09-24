import { expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { getEnv } from "@/server/env";
import { prisma } from "@/server/db/prisma";
import { bucketHash } from "@/server/modules/rate-limit/postgres";

test("production handlers validate real secure sessions and share GET/HEAD quota", async () => {
  const id = randomUUID();
  const keyHash = bucketHash("read", id);
  const password = "Synthetic-Production-Read-2026!";
  const email = `production-read-${id}@orbit.test`;
  const auxiliary = new URL(process.env.TEST_DATABASE_URL!);
  auxiliary.pathname = "/orbit_auxiliary_test"; // Validation only; never connected.
  try {
    await prisma.user.create({ data: {
      id, email, name: "Production mode fixture", emailVerified: true,
      accounts: { create: { accountId: id, providerId: "credential", password: await hashPassword(password) } },
    } });
    vi.stubEnv("APP_ENV", "production");
    // D1：生产拓扑 = 本机 Nginx 单层受信代理（infra/nginx.conf），必须显式 ≥1。
    vi.stubEnv("TRUSTED_PROXY_COUNT", "1");
    vi.stubEnv("APP_URL", "https://orbit.example.test");
    vi.stubEnv("BETTER_AUTH_URL", "https://orbit.example.test");
    vi.stubEnv("AUTH_TRUSTED_ORIGINS", "https://orbit.example.test");
    vi.stubEnv("STORAGE_ENDPOINT", "https://storage.example.test");
    vi.stubEnv("TEST_DATABASE_URL", auxiliary.href);
    getEnv(true);
    const { auth } = await import("@/server/auth");
    const { requireSessionUser } = await import("@/server/auth/session");
    const { GET } = await import("@/app/api/v1/tasks/[taskId]/route");
    const login = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    expect(login.status).toBe(200);
    const cookies = login.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.includes("Secure") && cookie.includes("HttpOnly"))).toBe(true);
    const cookie = cookies.map((value) => value.split(";")[0]).join("; ");
    const request = (method: string) => new Request("https://orbit.example.test/api/v1/tasks/" + randomUUID(), { method, headers: { cookie } });
    // A valid session does not grant access to an unrelated/missing task.
    expect((await GET(request("GET"), { params: Promise.resolve({ taskId: randomUUID() }) })).status).toBe(404);
    await prisma.rateLimitBucket.update({ where: { keyHash }, data: { count: 299 } });
    await expect(requireSessionUser(request("HEAD"))).resolves.toMatchObject({ id });
    for (const method of ["GET", "HEAD"]) {
      const denied = await GET(request(method), { params: Promise.resolve({ taskId: randomUUID() }) });
      expect(denied.status).toBe(429);
      // F02：Retry-After 现在携带桶的精确剩余秒数（正整数，保守上界 60），
      // 不再断言恒等于 60。
      const retryAfter = Number(denied.headers.get("retry-after"));
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    }
    const anonymous = await GET(new Request("https://orbit.example.test/api/v1/tasks/" + randomUUID()), { params: Promise.resolve({ taskId: randomUUID() }) });
    expect(anonymous.status).toBe(401);
  } finally {
    vi.unstubAllEnvs();
    getEnv(true);
    await prisma.rateLimitBucket.deleteMany({ where: { keyHash } });
    await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
  }
});
