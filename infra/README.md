# 本地服务与生产编排

- compose.dev.yml 启动仅监听回环地址的 PostgreSQL、SeaweedFS 和 Mailpit。
- compose.micro.yml 为单机部署，compose.production.yml 接入外部数据库。
- Nginx、维护、成对备份、异地快照与告警配置见 [部署与恢复](../docs/OCI-DEPLOYMENT.md)。

默认宿主端口为 PostgreSQL 5432、S3 9000、Mailpit SMTP 25025 和 Web 8025。若 PostgreSQL 端口冲突，启动 Compose 时设置 POSTGRES_HOST_PORT，并在 .env.local 同步 DATABASE_URL 和 TEST_DATABASE_URL 的端口。Mailpit 可用 MAILPIT_SMTP_HOST_PORT 和 MAILPIT_WEB_HOST_PORT 改端口，应用与测试分别同步 SMTP_PORT 和 MAILPIT_API。
