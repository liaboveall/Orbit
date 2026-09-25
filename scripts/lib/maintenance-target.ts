import { createHash } from "node:crypto";
import { z } from "zod";

export type MaintenanceScope = "all" | "attachments" | "idempotency" | "invitation-tokens" | "invitation-inspect";
const appEnv = z.enum(["development", "test", "staging", "production"]);
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "postgres", "storage"]);

/** Pure preflight: must run before importing any database/storage client. Never echo inputs. */
export class MaintenancePreflightError extends Error { override name = "MaintenancePreflightError"; }
export function maintenanceIntent(scope: MaintenanceScope, args: string[], env: Record<string, string | undefined>) {
  const environment = appEnv.safeParse(env.APP_ENV);
  if (!environment.success) throw new MaintenancePreflightError("维护必须显式设置合法 APP_ENV。");
  if (args.some(arg => !["--execute", "--dry-run"].includes(arg) && !/^--target=[a-f0-9]{64}$/.test(arg)) ||
      new Set(args).size !== args.length || args.filter(arg => arg.startsWith("--target=")).length > 1 ||
      (args.includes("--execute") && args.includes("--dry-run")))
    throw new MaintenancePreflightError("维护参数不合法：默认预览；执行使用 --execute --target=<预览指纹>。");
  let database: URL, storage: URL | undefined;
  try {
    database = new URL(env.DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(database.protocol) || !/^\/[^/]+$/.test(database.pathname)) throw new Error();
    // libpq query parameters must not silently override the inspected target.
    if ([...database.searchParams.keys()].some(key => !["schema", "sslmode", "sslaccept", "connection_limit", "pool_timeout"].includes(key))) throw new Error();
    if (scope === "all" || scope === "attachments") {
      storage = new URL(env.STORAGE_ENDPOINT ?? "");
      if (!["http:", "https:"].includes(storage.protocol) || !env.STORAGE_BUCKET || storage.username || storage.password || storage.search || storage.hash) throw new Error();
    }
  } catch { throw new MaintenancePreflightError("维护目标配置不合法；检查 DATABASE_URL 和存储配置（值不回显）。"); }
  if (["development", "test"].includes(environment.data)) {
    const suffix = environment.data === "test" ? "test" : "dev";
    if (!localHosts.has(database.hostname) || decodeURIComponent(database.pathname) !== `/orbit_${suffix}` ||
        (storage && (!localHosts.has(storage.hostname) || env.STORAGE_BUCKET !== `orbit-${suffix}`)))
      throw new MaintenancePreflightError("开发/测试维护只允许本机对应 orbit_dev/orbit_test 与 orbit-dev/orbit-test 桶。");
  }
  database.username = ""; database.password = "";
  database.searchParams.sort();
  const target = createHash("sha256").update(JSON.stringify({ scope, environment: environment.data,
    database: database.href, storage: storage?.href, bucket: storage ? env.STORAGE_BUCKET : undefined,
    region: storage ? env.STORAGE_REGION : undefined,
  })).digest("hex");
  const execute = args.includes("--execute");
  const acknowledged = args.find(arg => arg.startsWith("--target="))?.slice(9) ?? env.ORBIT_MAINTENANCE_TARGET;
  if (execute && acknowledged !== target) throw new MaintenancePreflightError("执行目标未确认或已变化；先运行只读预览，再提供匹配的 --target 或 ORBIT_MAINTENANCE_TARGET。");
  return { execute, target, environment: environment.data, scope };
}
