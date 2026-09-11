# src/server · 业务层（服务端专用）

本层由 `server-only` 保护，含数据库、认证、凭证与内部授权逻辑，**禁止进入客户端 bundle**。
数据库、认证、存储 SDK 只允许在此层引用（见 AGENTS.md、docs/03 §3/§5）。

规划子结构（按里程碑「按需」创建，不预建空服务）：

| 子目录 | 职责 | 引入里程碑 |
|---|---|---|
| `db/` | Prisma 7 singleton（driver adapter）、事务帮助函数 | M0（已建 `db/prisma.ts`） |
| `auth/` | Better Auth、会话、项目授权 | M1（ORB-004） |
| `modules/` | project/task/invite/comment/file 等领域服务 | M2 起 |
| `integrations/` | storage、mail、未来 AI provider | M5/M7 |
| `http/` | 错误映射、Origin 验证、请求 ID、限流 | M1（ORB-004） |

M0 已提供：`env.ts`（启动期 Zod 环境校验）、`db/prisma.ts`（Prisma 7 + PrismaPg adapter 单例）。
