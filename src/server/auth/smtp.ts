import "server-only";
import { createConnection } from "node:net";
import { createTransport, type SendMailOptions } from "nodemailer";
import type { OrbitEnv } from "@/server/env";

/** One cancellable connection per message; closing a non-pooled transporter
 * alone does not close its in-flight SMTP connection in nodemailer 10.0.1. */
export async function sendMailWithBudget(env: OrbitEnv, message: SendMailOptions): Promise<void> {
  const controller = new AbortController();
  const transport = createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    requireTLS: env.APP_ENV === "production" || env.APP_ENV === "staging",
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    getSocket(_options, callback) {
      if (controller.signal.aborted) { callback(new Error("SMTP send cancelled")); return; }
      const socket = createConnection({
        host: env.SMTP_HOST, port: env.SMTP_PORT, signal: controller.signal,
      });
      const connecting = setTimeout(() => socket.destroy(new Error("SMTP connect timeout")), 10_000);
      const failed = (error: Error) => { clearTimeout(connecting); callback(error); };
      socket.once("error", failed);
      socket.once("connect", () => {
        clearTimeout(connecting);
        socket.removeListener("error", failed);
        // Nodemailer performs implicit TLS / STARTTLS over this socket and
        // retains its default certificate verification. Abort closes both.
        callback(null, { connection: socket });
      });
      socket.once("close", () => clearTimeout(connecting));
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      transport.sendMail(message),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("SMTP send budget exceeded"));
        }, 20_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    transport.close();
  }
}
