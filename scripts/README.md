# scripts · 维护与工具脚本

放置 seed 之外的运维/工具脚本（清理、导出测试报告、连接探测等）。所有脚本必须：

- 显式加载约定环境文件（`.env.local`，回退 `.env`），不依赖只有 Next 才能读到的环境；
- 不回显秘密/连接串；失败以非零码退出；
- 幂等、限批量（维护类脚本见 docs/08 §6）。

| 脚本 | 用途 | 运行 |
|---|---|---|
| `check-db.ts` | 只读探测 `DATABASE_URL` 是否可连接（M0 验收：空库可连接） | `pnpm exec tsx scripts/check-db.ts` |
| `cleanup-idempotency.ts` | 分批删除过期幂等记录（走 `expiresAt` 索引，短事务限批量，离线运行） | `pnpm exec tsx scripts/cleanup-idempotency.ts` |

> 业务 seed 在 `prisma/seed.ts`（由 `pnpm db:seed` 调用）。`worker:ai` 属 M7。

M6：`pnpm maintenance:cleanup` 限批清理过期运行记录和附件；
`node --conditions=react-server --import tsx scripts/recovery-drill.ts` 在随机命名的本地临时库执行真实恢复演练；
`node scripts/container-smoke.mjs` 验证已构建的 `orbit:m6` 镜像。完整发布步骤见 [运行手册](../docs/M6-OPERATIONS.md)。


邀请令牌维护：`pnpm exec tsx scripts/cleanup-invitation-tokens.ts` 默认只读统计。
修改数据需显式传入 `--apply --database=<精确数据库名>`，事务失败返回非零状态。
历史 `cleanup-migration.ts` 已停用，不可用于删除迁移历史。完整规则见
[环境与维护文档](../docs/08-ENVIRONMENT-AND-DEPLOYMENT.md)。
