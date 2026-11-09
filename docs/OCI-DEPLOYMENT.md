# 部署与恢复

Orbit 以两个 OCI 镜像运行。Dockerfile 的 runner 目标提供 Web 服务，operations 目标运行迁移与维护。公网入口通过 Nginx 提供 HTTPS。生产 PostgreSQL 和附件存储位于 Compose 内网，备份以加密快照写入私有 R2 桶。

## 配置生产环境

- [单机编排](../infra/compose.micro.yml) 使用同机 PostgreSQL，可启用 local-storage 配置运行 SeaweedFS。[外部数据库编排](../infra/compose.production.yml) 适用于托管 PostgreSQL。
- 单机编排安装为 /opt/orbit/compose.yml。app.env 包含应用配置，db.env 包含 PostgreSQL 配置，storage.env 为 SeaweedFS 注入 AWS_ACCESS_KEY_ID 和 AWS_SECRET_ACCESS_KEY。首次启动时创建专用的应用角色和数据库。应用使用该角色连接 postgres:5432。
- 参照 [.env.example](../.env.example) 设置 APP_ENV=production、APP_URL、BETTER_AUTH_URL、AUTH_TRUSTED_ORIGINS、BETTER_AUTH_SECRET、DATABASE_URL 和 STORAGE_*。HTTPS 域名在三个地址字段中一致，数据库和存储密钥单独生成。配置文件权限设为 0600。
- 附件使用私有 S3 桶。单机编排使用 STORAGE_ENDPOINT=http://storage:8333、STORAGE_BUCKET=orbit-attachments 与路径式访问。外部对象存储使用 HTTPS。TEST_DATABASE_URL 按配置校验提供独立测试目标，生产应用使用 DATABASE_URL。
- 配置已验证的发件域、MAIL_FROM 和 SMTP_*。使用 SMTPS 或受强制校验的 STARTTLS。生产使用 Resend。[凭证更新脚本](../infra/apply-external-config.py) 从标准输入读取邮件或 R2 凭证，并将原配置保存在服务器受限目录中。
- 使用 [Nginx 虚拟主机](../infra/nginx-site.conf)、[HTTPS 代理片段](../infra/nginx.conf) 和 [HTTP 配置](../infra/nginx-http.conf)。新主机配置域名 DNS 和证书后运行 nginx -t，再重载。单层可信代理使用 TRUSTED_PROXY_COUNT=1，Web 容器端口仅绑定 127.0.0.1。证书续期后重载 Nginx。

## 构建与更新

使用通过 CI 的提交，在目标架构上构建 runner 和 operations。对单机编排，在切换 showcase 标签前保存旧镜像的提交标签作为回退点。已有生产数据先完成成对备份。

~~~sh
sha=$(git rev-parse --short=12 HEAD)
docker build --target runner -t "orbit-web:$sha" .
docker build --target operations -t "orbit-operations:$sha" .
docker tag "orbit-web:$sha" orbit-web:showcase
docker tag "orbit-operations:$sha" orbit-operations:showcase

sudo docker compose -f /opt/orbit/compose.yml --profile local-storage up -d --wait postgres storage
sudo docker compose -f /opt/orbit/compose.yml stop web
sudo docker compose -f /opt/orbit/compose.yml run --rm operations node node_modules/prisma/build/index.js migrate deploy
sudo docker compose -f /opt/orbit/compose.yml run --rm operations node --conditions=react-server --import tsx scripts/storage-check.ts
sudo docker compose -f /opt/orbit/compose.yml up -d --wait web
curl --fail https://smartorbit.tech/health/ready
~~~

就绪检查核对迁移与必需列。上线后核对登录、任务和附件流程。迁移失败时排查状态与数据，已应用的迁移文件不可改写。应用回滚使用与当前 schema 兼容的旧镜像。

## 定时维护

operations 默认执行只读预览。核对目标环境并将 maintenance_preview 打印的 target 设置为 ORBIT_MAINTENANCE_TARGET，之后才执行写入。数据库或存储目标变化后重新预览。

~~~cron
20 * * * * /usr/bin/flock -n /run/orbit-maintenance.lock /usr/bin/docker compose -f /opt/orbit/compose.yml run --rm operations node --conditions=react-server --import tsx scripts/maintenance-cleanup.ts --execute >> /var/log/orbit-maintenance.log 2>&1
10 3 * * * /usr/bin/flock -n /run/orbit-backup.lock /opt/orbit/backup-local.sh >> /var/log/orbit-backup.log 2>&1
40 3 * * * /opt/orbit/backup-offsite.sh >> /var/log/orbit-backup.log 2>&1
~~~

将 [本地备份](../infra/backup-local.sh)、[批次选择](../infra/select-backup.sh) 和 [异地备份](../infra/backup-offsite.sh) 安装到 /opt/orbit，并配置日志轮换。上例为 UTC。异地备份使用 backup.env、私有 R2 桶和 restic-password，完成后按清单读回校验。restic 密码和恢复所需的 R2 访问方式须保存于独立位置。

服务器告警由 [monitor.py](../infra/monitor.py) 和 [systemd timer](../infra/systemd/orbit-monitor.timer) 调度，收件人与 SMTP 配置保存在服务器的 monitor.env。[GitHub 外部探测](../.github/workflows/uptime.yml) 检查公网就绪端点。

## 恢复

1. 用 select-backup.sh 确定数据库 dump 和 SeaweedFS 归档属于同一完整批次。整机不可用时，从 R2 用 restic 恢复快照到隔离目录，对照 backup-批次.sha256 校验，获取编排和环境文件。快照包含受限配置，按凭证文件管理。
2. 在隔离目标启动兼容的 PostgreSQL 与 SeaweedFS。数据库使用 pg_restore 恢复到新库，附件归档解压到对应 SeaweedFS 镜像的空数据卷。保持目录所有权、桶和对象键，避免连接线上卷。
3. 核对迁移状态、项目成员、任务、评论和样例附件哈希。使用对应版本启动应用，核对 ready、登录与下载。
4. 确需恢复生产时先保存现状，再切换到验证过的恢复目标。整机重建还需恢复 Nginx、HTTPS、cron 和 systemd 调度。正式数据卷保留独立恢复点。

本地备份会暂停 SeaweedFS 以保证数据库快照和附件配对。暂停期间附件不可用。可用 [容量脚本](../scripts/capacity-test.sh) 在一次性合成环境检查备份与业务负载重叠时的影响。
