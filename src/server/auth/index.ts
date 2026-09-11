import "server-only";
import { prisma } from "@/server/db/prisma";
import { getEnv } from "@/server/env";
import { createAuth } from "./options";

/**
 * Better Auth 应用单例（M1 / ORB-004）。
 *
 * 绑定应用 Prisma 单例（src/server/db/prisma.ts，指向 DATABASE_URL）与已校验环境。
 * server-only 保护：认证含密钥/数据库，禁止进入客户端 bundle（AGENTS.md、docs/03 §3）。
 *
 * 客户端交互通过 /api/auth/* 路由（src/app/api/auth/[...all]/route.ts）；
 * 服务端会话校验通过 ./session.ts 的 getSessionUser。测试用 ./options.ts 的 createAuth
 * 绑定独立测试库客户端，绝不复用此单例。
 */
export const auth = createAuth(prisma, getEnv());

/** Better Auth 实例类型。 */
export type Auth = typeof auth;

/** 会话推断类型：{ user, session }。 */
export type AuthSession = typeof auth.$Infer.Session;

/** 会话中的用户类型（含 timezone 扩展字段）。 */
export type AuthUser = AuthSession["user"];

/** 会话记录类型。 */
export type AuthSessionRecord = AuthSession["session"];
