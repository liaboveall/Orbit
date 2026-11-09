# 环境与部署

- compose.dev.yml：本地 PostgreSQL、S3 兼容存储（SeaweedFS）、Mailpit，仅绑定 localhost。
- postgres/init/01-create-test-db.sql：首次初始化独立测试库。
- compose.production.yml：生产服务编排。
- nginx.conf / nginx-http.conf：HTTPS 反向代理 / HTTP 引导配置。
- nginx-site.conf：OCI 生产的虚拟主机（规范主机、跳转与证书）。
- compose.micro.yml：单机部署编排。
- backup-database.sh：数据库备份。
- backup-local.sh / select-backup.sh：单机本地备份与完整批次选择。
- backup-offsite.sh：restic 加密异地备份并读回校验。
- apply-external-config.py：在服务器上写入 Resend 与 R2 凭证，不输出值。
- monitor.py / systemd/：单机告警程序及其定时器。
- s3-lifecycle.json / s3-backup-lifecycle.json：对象存储生命周期配置。

启动：`docker compose -f infra/compose.dev.yml up -d`。停止并保留数据卷：`docker compose -f infra/compose.dev.yml down`。

默认端口：PostgreSQL 5432、S3 兼容存储 9000、Mailpit SMTP 25025/Web 8025。附件私有桶 `orbit-dev` 在存储服务启动时自动创建。

生产镜像定义在 [Dockerfile](../Dockerfile)。配置与端口覆盖见 [环境文档](../docs/08-ENVIRONMENT-AND-DEPLOYMENT.md)；发布、备份和恢复见 [运行手册](../docs/M6-OPERATIONS.md)。
