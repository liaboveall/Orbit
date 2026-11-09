# 运行与验证工具

- cleanup-attachments、cleanup-idempotency、cleanup-invitation-tokens 和 maintenance-cleanup 维护过期记录及附件。生产写入前先预览并确认目标指纹，见 [部署与恢复](../docs/OCI-DEPLOYMENT.md)。
- verify-migration-history、verify-compose、verify-nginx 和 container-smoke 检查迁移、部署配置和镜像入口。
- recovery-drill、verify-backup 和 verify-local-backup 验证备份与隔离恢复。
- e2e-server 与 verify-e2e-target 为 [浏览器测试](../tests/README.md) 管理隔离服务。
- check-image-scan 读取 [镜像安全规则](../infra/image-security-policy.json)。
