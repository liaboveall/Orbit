import type { Instrumentation } from "next";

/**
 * Next.js instrumentation。
 *
 * register() 在服务端启动时执行一次：这里做「启动期环境变量校验」，
 * 校验失败即让进程启动失败（fail fast），错误只含变量名与预期格式。
 * Edge runtime 不加载 server-only 模块，故用动态 import 并限定 nodejs。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getEnv, EnvValidationError } = await import("@/server/env");
  try {
    getEnv(true);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      // 只输出变量名与预期格式，不含任何变量值。
      console.error(error.message);
    }
    throw error;
  }
}

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const DIGEST = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * 服务端未捕获的请求错误（页面渲染、路由处理器、代理）。
 *
 * /api/v1 的路由处理器自己捕获异常并映射为信封，到这里的主要是页面渲染失败——此前只有
 * 框架打印的原始堆栈，没有可检索的结构化事件。这里记一条脱敏事件：固定的路由模式
 * （如 /app/projects/[id]/board，不是实际路径）、方法、上游 requestId、错误类别，以及
 * 用户错误页上显示的 digest，方便把一次报障对到日志。不记录路径、查询、请求头、
 * 错误消息或堆栈（docs/03 §8）。
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { logEvent } = await import("@/server/http/log");
  const { sanitizeErrorForLog } = await import("@/server/http/sanitize-error");
  const header = request.headers["x-request-id"];
  const requestId = Array.isArray(header) ? header[0] : header;
  const digest =
    typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : "";
  logEvent("error", {
    event: "request_error",
    ...sanitizeErrorForLog(error, requestId),
    routeType: context.routeType,
    routePath: context.routePath,
    method: METHODS.has(request.method) ? request.method : "OTHER",
    ...(DIGEST.test(digest) ? { digest } : {}),
  });
};
