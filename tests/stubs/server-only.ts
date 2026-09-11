// 空桩：仅在 Vitest（纯 Node 环境）中替代 `server-only`。
// `server-only` 包在非 react-server 条件下会抛错，测试里不需要该保护。
// 真实的 Next.js 构建仍会正常应用 server-only 边界。
export {};
