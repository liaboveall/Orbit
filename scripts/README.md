# 开发与维护工具

| 工具 | 用途 |
|---|---|
| `verify-remediation.mjs` | 顺序执行门禁，记录真实退出码、源码摘要和日志，产物写入被忽略的 artifacts |
| `verify-migration-history.mjs` | 只读核对本地开发/测试库与版本库迁移链 |
| `e2e-server.mjs`、`verify-e2e-target.mjs` | 启动隔离测试服务，核查 HTTP 状态和数据库目标 |
| `verify-process-tree.mjs`、`verify-web-server-lifecycle.mjs` | 测试进程清理和无关进程保护 |
| `measure-client-bundles.mjs` | 检查真实客户端路由未混入演示数据 |
| `verify-compose.mjs`、`verify-nginx.mjs`、`container-smoke.mjs` | 部署配置和真实容器检查 |
| `verify-image-policy.mjs`、`check-image-scan.mjs` | 镜像扫描与风险策略 |
| `verify-backup.sh`、`recovery-drill.ts` | 备份完整性及隔离恢复演练 |
| `maintenance-cleanup.ts`、`cleanup-attachments.ts`、`cleanup-idempotency.ts` | 运行记录与附件限批维护 |
| `cleanup-invitation-tokens.ts` | 旧邀请响应中的令牌清理，仍适用于已有数据库 |

维护工具加载 `.env.local` / `.env`，不回显凭证。需要写入的工具默认预览，执行参数以工具入口和 [运行手册](../docs/M6-OPERATIONS.md) 为准；邀请令牌工具要求 `--execute --target=<预览指纹>`。

当前数据库迁移使用 `pnpm db:migrate:deploy`；开发新迁移使用 `pnpm db:migrate:dev`。旧的一次性迁移修复入口已删除，不能通过清空迁移历史修复异常。
