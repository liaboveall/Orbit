# M6 运行手册

本手册提供可复现的发布步骤。真实部署地址、托管服务、HTTPS 双账户冒烟和远端 CI 结果未取得之前，ORB-021 保持待验收。

## 镜像和发布

`Dockerfile` 锁定 Node 24 bookworm-slim 的多架构 digest。运行层使用非 root 的 node 用户；生产环境文件由宿主注入，不能 COPY 到镜像。`ORBIT_STANDALONE=1` 只用于容器构建；日常 `pnpm build/start` 继续使用标准 Next server。

```text
docker build --target runner -t orbit:<commit> .
docker build --target operations -t orbit-operations:<commit> .
```

在目标平台设置 ORBIT_IMAGE、ORBIT_OPERATIONS_IMAGE 为审核过的同一提交镜像，ORBIT_ENV_FILE 为机器上的绝对环境文件路径。环境文件参照 `.env.example`；APP_ENV=staging/production，APP_URL 与 BETTER_AUTH_URL 完全一致且为 HTTPS，精确 AUTH_TRUSTED_ORIGINS，私有 HTTPS 对象存储，验证过的发件域。SMTP 使用供应商要求的 TLS/STARTTLS；数据库使用验证 CA 的 TLS 连接。TEST_DATABASE_URL 只需提供独立测试库形状，生产运行不会连接它。每实例连接池 5，连接等待 5 秒，查询 10 秒。

1. 在 staging 跑完整 CI 与合成数据验收。
2. 使用平台备份功能创建数据库恢复点，记录对象存储版本/备份恢复点。
3. 单独执行一次迁移，不在 web 启动时迁移：
   `docker compose -f infra/compose.production.yml run --rm operations pnpm db:migrate:deploy`
4. `docker compose -f infra/compose.production.yml up -d web`
5. `/health/live` 只验证进程；`/health/ready` 查询共享限流表，数据库/迁移不可用返回 503，无内部错误细节。这两个操作端点不属于业务 API，不含用户数据，禁止缓存。
6. 在 HTTPS 下用两个本人控制的账户注册、验证邮件、登录、邀请、写任务、评论、上传/下载、移除成员后验证拒绝访问。记录版本、地址、时间与结果。
7. 故障时回滚兼容的应用镜像，不盲目执行数据库 down migration。

`infra/nginx.conf` 放入已配置证书的 HTTPS virtual host。请求体上限 12 MiB，关闭上传缓冲；应用实际文件仍限 10 MiB。只有单层可信代理且源站不可直连时使用 TRUSTED_PROXY_COUNT=1；片段覆盖 XFF，不能直接套用在多层链路。

## 共享准入与维护

staging/production 使用 PostgreSQL 原子固定窗口：业务写 60/用户/分钟、业务 GET 300/用户/分钟、邀请预览和接受合计 20/IP/分钟。Better Auth 1.7.3 的 `customStorage.consume` 使用同一原子实现并保留现有各端点阈值；数据库只持久化命名空间和标识的 SHA-256，不记录原始 IP/邮箱。development/test 保留内存路径，双连接池集成测试专门验证 PostgreSQL 实现。

上传使用独立数据库滑动分钟（10 次）和最多 2 个并发租约。事务级 advisory lock 串行化同用户准入；不在事务内上传。120 秒请求超时，租约 180 秒自动过期；finally 幂等释放活跃状态但保留频率记录。

平台按计划（维护脚本默认每小时可运行一次，实际节奏由部署方配置 cron/调度决定）执行 operations 镜像的 `pnpm maintenance:cleanup`：单批最多 10 批 × 1000 条过期幂等/限流/租约记录（分批排空，批间让位），附件清理每批 100 条；同机并发运行由 flock 串行化，不会双跑。日志只含数量、释放字节和成功/失败事件。失败返回非零，交给平台告警；积压较大时增加调度频率。仓库不自动创建真实平台定时任务。

## 备份与恢复

数据库每日备份保留至少 7 天；对象存储开启版本/备份并同样设定保留策略。记录备份时间、迁移版本和对象版本。目标 RPO≤24h/RTO≤2h，必须以生产平台实际配置和演练确认。

`node --conditions=react-server --import tsx scripts/recovery-drill.ts` 在本地 PostgreSQL 容器创建两个随机命名的独立临时库，迁移空库、写合成成员/任务/评论/活动/附件，真实 pg_dump/pg_restore 并恢复 MinIO 对象到独立前缀，验证版本与摘要。仅精确删除本次新建临时数据库和对象，不备份或清空用户库。输出 `artifacts/release/recovery.json`。它不替代生产定时备份配置。

## 配置与外部验收待办

- 容器平台/服务器与域名，staging/production 分离。
- PostgreSQL、私有 S3 和真实邮件服务凭证，以环境变量或 secret manager 提供。
- 发布镜像仓库权限、部署入口、TLS 证书、域名邮件验证。
- 远端 CI run 链接、每日维护/备份调度、告警接收人。
- HTTPS 双账户冒烟和生产恢复点验证。

## 官方资料

- [Next 自托管](https://nextjs.org/docs/app/guides/self-hosting)；实现另核对已安装 Next 16.3.4 的 output/self-hosting 文档。
- [Better Auth 限流](https://better-auth.com/docs/concepts/rate-limit)；consume 签名核对已安装 1.7.3 源码。
- [PostgreSQL 17 dump/restore](https://www.postgresql.org/docs/17/backup-dump.html)。
- [tailwind-merge 自定义主题](https://github.com/dcastil/tailwind-merge/blob/main/docs/configuration.md)。
