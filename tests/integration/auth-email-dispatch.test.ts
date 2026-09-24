import { createServer, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { parseEnv } from "@/server/env";
import { createAuth } from "@/server/auth/options";
import { drainAuthEmails } from "@/server/auth/email-dispatch";
import { cleanupAuthUsers } from "../support/auth-cleanup";

/**
 * 认证邮件不在请求内等待 SMTP（AUTH-VERIFY-FAILURE 与时序旁路回归）。
 *
 * 用仅监听本机的合成 SMTP：拒收（421）或永不发送 greeting。匿名入口的状态、正文与耗时
 * 不得随账号是否存在/是否已验证而变化；投递仍在响应之后真实发起。未向外部发信。
 */

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const env = parseEnv(process.env as Record<string, string | undefined>);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.TEST_DATABASE_URL }) });
const TAG = `authmail-${randomUUID().slice(0, 8)}`;
/** 远小于 nodemailer 10 秒 greeting 超时：若仍在请求内等待 SMTP，断言必然失败。 */
const FAST_RESPONSE_MS = 3000;

type SmtpStub = { port: number; connections: () => number; close: () => Promise<void> };

async function smtpStub(mode: "reject" | "hang"): Promise<SmtpStub> {
  const sockets = new Set<Socket>();
  let connections = 0;
  const server = createServer((socket) => {
    connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    if (mode === "reject") socket.end("421 synthetic unavailable\r\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing SMTP port");
  return {
    port: address.port,
    connections: () => connections,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function authWith(smtp: SmtpStub) {
  return createAuth(prisma, {
    ...env, APP_ENV: "test", SMTP_HOST: "127.0.0.1", SMTP_PORT: smtp.port,
    SMTP_SECURE: false, SMTP_USER: "", SMTP_PASSWORD: "",
  });
}

async function post(auth: ReturnType<typeof authWith>, path: string, body: unknown) {
  const started = performance.now();
  const response = await auth.handler(new Request(`${env.APP_URL}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: env.APP_URL },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.text(), ms: performance.now() - started };
}

async function accounts(label: string) {
  const verified = `${TAG}-${label}-verified@orbit.test`;
  const unverified = `${TAG}-${label}-unverified@orbit.test`;
  await prisma.user.createMany({ data: [
    { email: verified, name: "已验证合成用户", emailVerified: true },
    { email: unverified, name: "未验证合成用户", emailVerified: false },
  ] });
  return { verified, unverified, missing: `${TAG}-${label}-missing@orbit.test` };
}

afterAll(async () => {
  await drainAuthEmails();
  await cleanupAuthUsers(prisma, TAG);
  await prisma.$disconnect();
});

describe("认证邮件在响应之后投递", () => {
  it("匿名重发验证邮件：SMTP 拒收时，未验证/不存在/已验证账号得到相同的 200 响应", async () => {
    const smtp = await smtpStub("reject");
    try {
      const auth = authWith(smtp);
      const { verified, unverified, missing } = await accounts("resend");
      const results = [];
      for (const email of [unverified, missing, verified])
        results.push(await post(auth, "/send-verification-email", { email, callbackURL: "/auth/verify" }));
      expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
      expect(new Set(results.map((result) => result.body)).size).toBe(1);
      await drainAuthEmails();
      // 只有未验证账号真正触发投递；失败只进入脱敏日志。
      expect(smtp.connections()).toBe(1);
    } finally {
      await smtp.close();
    }
  });

  it("找回密码：SMTP 停滞时，已注册与未注册邮箱都立即返回相同响应，投递在之后发起", async () => {
    const smtp = await smtpStub("hang");
    try {
      const auth = authWith(smtp);
      const { verified, missing } = await accounts("reset");
      const registered = await post(auth, "/request-password-reset", { email: verified, redirectTo: "/auth/reset-password" });
      const unregistered = await post(auth, "/request-password-reset", { email: missing, redirectTo: "/auth/reset-password" });
      expect([registered.status, unregistered.status]).toEqual([200, 200]);
      expect(registered.body).toBe(unregistered.body);
      expect(registered.ms).toBeLessThan(FAST_RESPONSE_MS);
      await expect.poll(() => smtp.connections()).toBe(1);
    } finally {
      await smtp.close();
      await drainAuthEmails();
    }
  });

  it("注册：新邮箱不再等待 SMTP，已存在邮箱仍返回通用成功响应", async () => {
    const smtp = await smtpStub("hang");
    try {
      const auth = authWith(smtp);
      const { verified } = await accounts("signup");
      const fresh = await post(auth, "/sign-up/email", { email: `${TAG}-signup-new@orbit.test`, password: "Synthetic-Signup-2026!", name: "新注册" });
      const existing = await post(auth, "/sign-up/email", { email: verified, password: "Synthetic-Signup-2026!", name: "重复注册" });
      expect([fresh.status, existing.status]).toEqual([200, 200]);
      expect(fresh.ms).toBeLessThan(FAST_RESPONSE_MS);
      await expect.poll(() => smtp.connections()).toBe(1);
    } finally {
      await smtp.close();
      await drainAuthEmails();
    }
  });
});
