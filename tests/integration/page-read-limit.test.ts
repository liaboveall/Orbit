import { expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { getEnv } from "@/server/env";
import { prisma } from "@/server/db/prisma";
import { bucketHash } from "@/server/modules/rate-limit/postgres";

/**
 * PAGE-READ-LIMIT 回归：服务端页面数据入口与 API GET/HEAD 共用每用户读取额度。
 *
 * 真实会话、真实 PostgreSQL 桶与生产配置；只替换 Next 请求作用域能力（请求头与
 * redirect 信号），以便在测试进程中调用真实的 requirePageUser()。
 */

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

async function redirectTarget(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const url = (error as { url?: unknown }).url;
    if (typeof url === "string") return url;
    throw error;
  }
  throw new Error("expected a redirect");
}

test("production page reads consume the shared per-user read bucket and redirect when exhausted", async () => {
  const id = randomUUID();
  const keyHash = bucketHash("read", id);
  const password = "Synthetic-Page-Read-2026!";
  const email = `page-read-${id}@orbit.test`;
  const auxiliary = new URL(process.env.TEST_DATABASE_URL!);
  auxiliary.pathname = "/orbit_auxiliary_test"; // Validation only; never connected.
  try {
    await prisma.user.create({ data: {
      id, email, name: "Page read fixture", emailVerified: true,
      accounts: { create: { accountId: id, providerId: "credential", password: await hashPassword(password) } },
    } });
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("TRUSTED_PROXY_COUNT", "1");
    vi.stubEnv("APP_URL", "https://orbit.example.test");
    vi.stubEnv("BETTER_AUTH_URL", "https://orbit.example.test");
    vi.stubEnv("AUTH_TRUSTED_ORIGINS", "https://orbit.example.test");
    vi.stubEnv("STORAGE_ENDPOINT", "https://storage.example.test");
    vi.stubEnv("TEST_DATABASE_URL", auxiliary.href);
    getEnv(true);
    const { auth } = await import("@/server/auth");
    const { requirePageUser } = await import("@/server/auth/page-session");
    const { GET } = await import("@/app/api/v1/tasks/[taskId]/route");

    request.headers = new Headers({ "x-orbit-return-to": "/app/projects/p/board?q=a&_rsc=abc" });
    expect(await redirectTarget(requirePageUser())).toBe(
      "/auth/login?returnTo=" + encodeURIComponent("/app/projects/p/board?q=a"),
    );

    const login = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    expect(login.status).toBe(200);
    const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    request.headers = new Headers({ cookie, "x-orbit-return-to": "/app/projects/p/board?q=a&_rsc=abc" });

    await expect(requirePageUser()).resolves.toMatchObject({ id });
    expect((await prisma.rateLimitBucket.findUniqueOrThrow({ where: { keyHash } })).count).toBe(1);

    // The last token goes to a page render; the API then shares the exhausted bucket.
    await prisma.rateLimitBucket.update({ where: { keyHash }, data: { count: 299 } });
    await expect(requirePageUser()).resolves.toMatchObject({ id });
    const api = await GET(
      new Request("https://orbit.example.test/api/v1/tasks/" + randomUUID(), { headers: { cookie } }),
      { params: Promise.resolve({ taskId: randomUUID() }) },
    );
    expect(api.status).toBe(429);

    const target = new URL(await redirectTarget(requirePageUser()), "https://orbit.example.test");
    expect(target.pathname).toBe("/rate-limited");
    expect(target.searchParams.get("returnTo")).toBe("/app/projects/p/board?q=a");
    const retryAfter = Number(target.searchParams.get("retryAfter"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  } finally {
    vi.unstubAllEnvs();
    getEnv(true);
    await prisma.rateLimitBucket.deleteMany({ where: { keyHash } });
    await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
  }
});
