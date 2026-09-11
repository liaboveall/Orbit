# scripts · 维护与工具脚本

放置 seed 之外的运维/工具脚本（清理、导出测试报告、连接探测等）。所有脚本必须：

- 显式加载约定环境文件（`.env.local`，回退 `.env`），不依赖只有 Next 才能读到的环境；
- 不回显秘密/连接串；失败以非零码退出；
- 幂等、限批量（维护类脚本见 docs/08 §6）。

| 脚本 | 用途 | 运行 |
|---|---|---|
| `check-db.ts` | 只读探测 `DATABASE_URL` 是否可连接（M0 验收：空库可连接） | `pnpm exec tsx scripts/check-db.ts` |
| `cleanup-idempotency.ts` | 分批删除过期幂等记录（走 `expiresAt` 索引，短事务限批量，离线运行） | `pnpm exec tsx scripts/cleanup-idempotency.ts` |

> 业务 seed 在 `prisma/seed.ts`（由 `pnpm db:seed` 调用）。`maintenance:cleanup`、`worker:ai` 属后续里程碑。
