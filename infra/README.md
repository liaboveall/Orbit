# 环境与部署

- compose.dev.yml：本地 PostgreSQL、MinIO、Mailpit，仅绑定 localhost。
- postgres/init/01-create-test-db.sql：首次初始化独立测试库。
- compose.production.yml：生产服务编排。
- nginx.conf / nginx-http.conf：HTTPS 反向代理 / HTTP 引导配置。
- backup-database.sh：数据库备份。
- s3-lifecycle.json / s3-backup-lifecycle.json：对象存储生命周期配置。

启动：`docker compose -f infra/compose.dev.yml up -d`。停止并保留数据卷：`docker compose -f infra/compose.dev.yml down`。

默认端口：PostgreSQL 5432、MinIO 9000/9001、Mailpit SMTP 25025/Web 8025。附件私有桶按根 README 创建。

生产镜像定义在 [Dockerfile](../Dockerfile)。配置与端口覆盖见 [环境文档](../docs/08-ENVIRONMENT-AND-DEPLOYMENT.md)；发布、备份和恢复见 [运行手册](../docs/M6-OPERATIONS.md)。
