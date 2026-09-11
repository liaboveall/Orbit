/**
 * src/contracts 统一导出入口（ORB-003）。
 *
 * 契约层：Zod schemas、DTO 类型、错误码、校验帮助函数与 API 客户端骨架。
 * **无服务端依赖**（无 server-only / Prisma / @/server），可在客户端与服务端共享；
 * 服务端仍会对所有外部输入重新校验，前端隐藏不构成权限控制（AGENTS.md、docs/03 §3）。
 *
 * 传输结构以 contracts/openapi.json 为准；文字语义见 docs/05-API-CONTRACT.md。
 */

export * from "./primitives";
export * from "./enums";
export * from "./error-codes";
export * from "./envelope";
export * from "./dto";
export * from "./helpers";
export * from "./client";
