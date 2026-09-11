import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

/**
 * Better Auth 全路由挂载（M1 / ORB-004）。
 *
 * 官方 Next.js 集成：`toNextJsHandler(auth)` 返回 GET/POST/PATCH/PUT/DELETE，
 * 由 catch-all 段 [...all] 承接 /api/auth/* 下的全部端点（sign-up/sign-in/get-session/
 * verify-email/reset-password 等，随 ORB-005 使用）。
 *
 * 说明：
 *  - 此路由在 src/app/api 下，不经过 /app/* 的会话门禁（proxy.ts session cookie + app/app/layout.tsx
 *    getSessionUser），生产可用。
 *  - 认证路由使用库内置 CSRF / trustedOrigins 控制，**不**叠加 src/server/http/origin.ts
 *    的自制 Origin 层，以免破坏回调（docs/03 §5）。
 *  - runtime=nodejs：认证依赖 Node 加密与数据库驱动，不在 Edge 运行（docs/03 §1）。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(auth);
