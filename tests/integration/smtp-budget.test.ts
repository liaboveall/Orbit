import { test, expect, vi } from "vitest";
import { createServer, type Socket } from "node:net";
import { createEmailSender } from "../../src/server/auth/email";
import { getEnv } from "../../src/server/env";

test("SMTP 总预算关闭慢速连接，不影响同 env 并发发送和后续发送", { timeout: 30_000 }, async () => {
  const sockets = new Set<Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let connections = 0, acceptedMessages = 0, slowClosed = false, slowData = false;
  let connected!: () => void;
  const firstConnected = new Promise<void>(resolve => { connected = resolve; });
  const server = createServer(socket => {
    const slow = ++connections === 1;
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => { sockets.delete(socket); if (slow) slowClosed = true; });
    socket.write("220 local.test SMTP\r\n");
    if (slow) connected();
    let buffer = "", data = false;
    socket.on("data", chunk => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (data) {
          if (line === ".") { acceptedMessages++; data = false; socket.write("250 queued\r\n"); }
          continue;
        }
        if (slow) {
          if (line === "DATA") slowData = true;
          const timer = setTimeout(() => { timers.delete(timer); if (!socket.destroyed) socket.write("250 local.test\r\n"); }, 8000);
          timers.add(timer);
        } else if (line === "DATA") { data = true; socket.write("354 continue\r\n"); }
        else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 local.test\r\n");
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  const sender = createEmailSender({ ...getEnv(), SMTP_HOST: "127.0.0.1", SMTP_PORT: address.port, SMTP_SECURE: false, SMTP_USER: "", SMTP_PASSWORD: "", MAIL_FROM: "budget@orbit.test" });
  const payload = { user: { id: "budget-test", email: "sink@orbit.test" }, token: "synthetic", url: "http://localhost/verify?token=synthetic" };
  try {
    const started = Date.now();
    const slow = sender.sendVerificationEmail(payload).then(() => false, () => true);
    await firstConnected;
    await sender.sendVerificationEmail(payload);
    expect(acceptedMessages).toBe(1);
    expect(await slow).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(19_000);
    expect(Date.now() - started).toBeLessThan(25_000);
    await expect.poll(() => slowClosed).toBe(true);
    expect(slowData).toBe(false);
    await sender.sendVerificationEmail(payload);
    expect(acceptedMessages).toBe(2);
  } finally {
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

/**
 * 认证邮件发送预算（D3 修复验收，docs/03 §8）。
 *
 * 用真实 TCP 协议替身复现「SMTP 接受连接后无 greeting 停滞」：
 *  - 修复前：nodemailer 默认 greeting 等待 2 分钟，黑洞 SMTP 挂住认证请求与连接；
 *  - 修复后：greetingTimeout=10s（+ 总发送预算 20s 兜底）内 sendMail 失败返回，
 *    且失败日志（auth_email_failed）只含用途 kind，不含邮箱地址/token。
 *
 * 拒绝类故障（无 STARTTLS 拒绝 AUTH 等）由 review-20260912.test.ts 的生产配置用例覆盖；
 * 存在/不存在账户的中性反馈由 auth-flow.test.ts 的登录用例覆盖。
 */

test("SMTP 无 greeting 停滞在预算内结束且日志不含邮箱地址", { timeout: 20_000 }, async () => {
  const server = createServer((socket) => {
    // 接受连接后故意不发送 220 banner，也不响应任何输入（停滞服务器）。
    socket.on("data", () => undefined);
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");

  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const sender = createEmailSender({
      ...getEnv(),
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: address.port,
      SMTP_SECURE: false,
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      MAIL_FROM: "budget@orbit.test",
    });

    const startedAt = Date.now();
    await expect(
      sender.sendVerificationEmail({
        user: { id: "budget-user", email: "victim@orbit.test" },
        token: "budget-token",
        url: "https://orbit.test/verify-email?token=budget-token",
      }),
    ).rejects.toThrow();
    const elapsed = Date.now() - startedAt;

    // greetingTimeout=10s；总预算 20s。允许少量调度抖动，但必须远小于修复前的 2 分钟默认。
    expect(elapsed).toBeLessThan(15_000);

    // 失败日志脱敏：只有 auth_email_failed + kind，无邮箱地址、无 token、无 URL。
    const logged = errorSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(logged).toContain("auth_email_failed");
    expect(logged).not.toContain("victim@orbit.test");
    expect(logged).not.toContain("budget-token");
  } finally {
    errorSpy.mockRestore();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
