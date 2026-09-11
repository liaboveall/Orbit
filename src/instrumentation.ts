/**
 * Next.js instrumentation（M0）。
 * register() 在服务端启动时执行一次：这里做「启动期环境变量校验」，
 * 校验失败即让进程启动失败（fail fast），错误只含变量名与预期格式。
 * 见 docs/08 §3。Edge runtime 不加载 server-only 模块，故用动态 import 并限定 nodejs。
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
