# Orbit Oracle Cloud 部署指南：ARM 2 核 12 GB（第一阶段）

更新：2026-09-26。用途：个人全栈作品展示。本文是操作指南，按顺序在你的 Oracle 实例上执行；服务器端尚未有人按本文执行过，遇到与描述不符的输出先停下排查。

第一阶段的范围和限制：

- **没有域名**：用 [sslip.io](https://sslip.io) 的“IP 即域名”主机名加 Let's Encrypt 证书提供 HTTPS。以后有了域名按第 13 节切换。
- **没有邮件服务**：认证邮件全部发送失败（只记日志）。Orbit 要求邮箱验证后才能登录，所以任何人注册后都无法自行登录；你自己的账户按第 11 节手动标记为已验证。公开的 `/demo` 不受影响，适合作为简历入口。
- **附件存在同一台服务器的 SeaweedFS**（ADR-030），与数据库同机。备份每天在服务器上生成，但**必须定期下载到你的电脑**，服务器上的备份扛不住整机故障或账户被停用。

## 1. 方案

浏览器 → HTTPS Nginx（宿主机）→ Orbit web 容器（127.0.0.1:3000）→ PostgreSQL 容器、SeaweedFS 容器（Docker 内网，不对外开放端口）。

镜像在 Windows 电脑上构建为 linux/arm64 后上传；服务器不构建、不跑测试。编排文件是仓库的 [infra/compose.micro.yml](../infra/compose.micro.yml)，通过 `local-storage` 配置启用 SeaweedFS。

Oracle 的两条规则要记住：

- **闲置回收**：Always Free 实例在 7 天内 CPU（95 百分位）、网络、内存（A1）使用率都低于 20% 时可能被回收。低访问量的展示站点很可能被判为闲置。可以把账户升级为按量付费（Pay As You Go）并设置预算提醒，官方说明只对超出免费额度的部分收费，但官方文档没有写明升级后免于回收。无论如何都要保持备份下载习惯。
- **免费额度会变**：A1 免费额度在 2026 年 6 月从 4 核 24 GB 降到 2 核 12 GB，事先没有公告。以 [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) 为准。

## 2. 需要替换的占位符

| 示例 | 替换为 |
|---|---|
| `YOUR_IP` | 实例公网 IPv4 |
| `YOUR_HOST` | 把 `YOUR_IP` 的点换成短横线再加 `.sslip.io`，例如 `203.0.113.5` → `203-0-113-5.sslip.io` |
| `KEY_PATH` | 创建实例时下载的 SSH 私钥，例如 `C:\Users\Mars\.ssh\oci-orbit.key` |
| `REPLACE_...` | 在服务器上生成的随机值，只填进服务器上的环境文件 |

**Windows PowerShell** 命令在电脑上执行；**服务器 Bash** 命令在 SSH 登录后执行。不要混用。密码和密钥不要发到聊天、不要提交到 Git。

## 3. 检查实例并开放 80/443

在 Oracle 控制台确认：

1. 实例规格为 `VM.Standard.A1.Flex`，2 OCPU、12 GB 内存；镜像是 Canonical Ubuntu 24.04（aarch64）；已分配公网 IPv4。
2. 网络 → 虚拟云网络 → 你的 VCN → 实例所在的公共子网 → 安全列表，添加两条入站规则：源 CIDR `0.0.0.0/0`，IP 协议 TCP，目标端口分别为 `80` 和 `443`。SSH 的 22 端口保持原样（能改成只允许你自己的 IP 更好）。数据库、应用和存储端口都不要开放。

**Windows PowerShell：**

```powershell
ssh -i "KEY_PATH" ubuntu@YOUR_IP
```

首次连接核对后接受主机指纹。若提示私钥权限过宽（UNPROTECTED PRIVATE KEY FILE），先执行 `icacls "KEY_PATH" /inheritance:r /grant:r "$($env:USERNAME):(R)"` 再连接。

**服务器 Bash：**

```bash
uname -m
free -h
df -h /
. /etc/os-release && echo "$PRETTY_NAME"
```

预期 `aarch64`、内存约 11 Gi、Ubuntu 24.04。

## 4. 主机防火墙（在安装 Docker 之前）

Oracle 的 Ubuntu 镜像自带 iptables 规则，默认只放行 SSH，安全列表放行后还要在主机上放行（参见 [Oracle 开发者博客](https://blogs.oracle.com/developers/enabling-network-traffic-to-ubuntu-images-in-oracle-cloud-infrastructure)）。新规则必须在 REJECT 之前，且保留 22 端口那一行。

**服务器 Bash：**

```bash
[ -f /etc/iptables/rules.v4.bak-orbit ] || sudo cp /etc/iptables/rules.v4 /etc/iptables/rules.v4.bak-orbit
grep -q -- '--dport 80 -j ACCEPT' /etc/iptables/rules.v4 || sudo sed -i '/--dport 22 -j ACCEPT/a -A INPUT -p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT\n-A INPUT -p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT' /etc/iptables/rules.v4
grep -n -E 'dport|REJECT' /etc/iptables/rules.v4
sudo iptables-restore < /etc/iptables/rules.v4
sudo iptables -L INPUT -n --line-numbers
```

预期顺序：22、80、443 三条 ACCEPT，然后才是 REJECT。重复执行不会插入重复规则。该文件开机时自动加载。

安装 Docker 之后如果还要改这个文件，执行 `iptables-restore` 后必须再执行 `sudo systemctl restart docker`，否则会冲掉 Docker 自己的规则。

## 5. 安装 Docker 与 Nginx

依据 [Docker Ubuntu 官方文档](https://docs.docker.com/engine/install/ubuntu/)，架构取本机值（arm64）。已有 Docker 时先运行 `docker --version`，不要重复安装。

**服务器 Bash：**

```bash
sudo apt update
sudo apt install -y ca-certificates curl nginx
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker nginx
sudo docker run --rm hello-world
sudo docker compose version
```

检查点：在电脑浏览器打开 `http://YOUR_IP`，应看到 Nginx 默认页。打不开就回到第 3、4 节检查安全列表和主机防火墙，不要继续。

## 6. 在 Windows 构建 ARM64 镜像并上传

先启动 Docker Desktop。镜像通过模拟构建，runner 约需 6–7 分钟，operations 复用缓存约 1 分钟。

**Windows PowerShell：**

```powershell
Set-Location D:\FullStack\Orbit
git switch main
git pull --ff-only
git status --short
$sha = git rev-parse --short HEAD
docker buildx build --platform linux/arm64 --target runner -t orbit-web:showcase -t "orbit-web:$sha" --load .
docker buildx build --platform linux/arm64 --target operations -t orbit-operations:showcase -t "orbit-operations:$sha" --load .
docker image inspect orbit-web:showcase --format "{{.Architecture}}"
New-Item -ItemType Directory -Force artifacts | Out-Null
docker save -o artifacts/orbit-arm64.tar orbit-web:showcase orbit-operations:showcase "orbit-web:$sha" "orbit-operations:$sha"
scp -i "KEY_PATH" artifacts/orbit-arm64.tar infra/compose.micro.yml infra/nginx-http.conf infra/nginx.conf infra/backup-local.sh ubuntu@YOUR_IP:/home/ubuntu/
$sha
```

`git status --short` 应无输出；架构应显示 `arm64`。记下最后打印的 `$sha`，它是这次发布的提交版本。

**服务器 Bash：**

```bash
sed -i 's/\r$//' /home/ubuntu/compose.micro.yml /home/ubuntu/nginx-http.conf /home/ubuntu/nginx.conf /home/ubuntu/backup-local.sh
sudo docker load -i /home/ubuntu/orbit-arm64.tar
sudo docker image ls | grep orbit
sudo install -d -m 700 /opt/orbit /opt/orbit/backups
sudo install -m 644 /home/ubuntu/compose.micro.yml /opt/orbit/compose.yml
sudo install -m 700 /home/ubuntu/backup-local.sh /opt/orbit/backup-local.sh
echo 'COMPOSE_PROFILES=local-storage' | sudo tee /opt/orbit/.env > /dev/null
sudo touch /opt/orbit/db.env /opt/orbit/storage.env /opt/orbit/app.env
sudo chmod 600 /opt/orbit/db.env /opt/orbit/storage.env /opt/orbit/app.env
rm /home/ubuntu/orbit-arm64.tar
```

第一行把 Windows 检出时的 CRLF 换行转成 LF。`/opt/orbit/.env` 让本目录的所有 compose 命令自动启用 `local-storage`，后续命令无需再加参数。

## 7. 生成随机值并填写环境文件

**服务器 Bash：** 执行四次，把输出分别存进你的密码管理器：

```bash
openssl rand -hex 24
openssl rand -hex 24
openssl rand -hex 24
openssl rand -hex 32
```

依次作为：数据库管理员密码、应用数据库密码、存储密钥、`BETTER_AUTH_SECRET`。用 `sudo nano /opt/orbit/db.env` 填写（nano 保存 Ctrl+O、回车，退出 Ctrl+X）：

```dotenv
POSTGRES_USER=postgres
POSTGRES_PASSWORD=REPLACE_DB_ADMIN_PASSWORD
POSTGRES_DB=postgres
```

`sudo nano /opt/orbit/storage.env`：

```dotenv
AWS_ACCESS_KEY_ID=orbit_storage
AWS_SECRET_ACCESS_KEY=REPLACE_STORAGE_SECRET
```

`sudo nano /opt/orbit/app.env`（三个地址完全一致、无尾部斜杠）：

```dotenv
APP_ENV=production
APP_URL=https://YOUR_HOST
BETTER_AUTH_URL=https://YOUR_HOST
AUTH_TRUSTED_ORIGINS=https://YOUR_HOST
BETTER_AUTH_SECRET=REPLACE_AUTH_SECRET
DATABASE_URL=postgresql://orbit_app:REPLACE_APP_DB_PASSWORD@postgres:5432/orbit_prod
TEST_DATABASE_URL=postgresql://unused:unused@127.0.0.1:5432/orbit_test
# 第一阶段不配邮件：smtp.invalid 是保留域名，保证解析失败，认证邮件只记失败日志。
SMTP_HOST=smtp.invalid
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_SECURE=false
MAIL_FROM="Orbit <no-reply@YOUR_HOST>"
# 同机 SeaweedFS（ADR-030）：容器内网地址，不经过公网。
STORAGE_ENDPOINT=http://storage:8333
STORAGE_REGION=us-east-1
STORAGE_BUCKET=orbit-attachments
STORAGE_ACCESS_KEY_ID=orbit_storage
STORAGE_SECRET_ACCESS_KEY=REPLACE_STORAGE_SECRET
STORAGE_FORCE_PATH_STYLE=true
TRUSTED_PROXY_COUNT=1
LOG_LEVEL=info
AI_ENABLED=false
ORBIT_MAINTENANCE_TARGET=
```

`STORAGE_SECRET_ACCESS_KEY` 与 storage.env 的 `AWS_SECRET_ACCESS_KEY` 是同一个值；`STORAGE_BUCKET` 必须是 `orbit-attachments`，存储服务启动时会创建这个桶。`TEST_DATABASE_URL` 只为通过配置校验，正式服务不会连接它。

## 8. 启动数据库与存储

**服务器 Bash：**

```bash
sudo docker compose -f /opt/orbit/compose.yml config --quiet
sudo docker compose -f /opt/orbit/compose.yml up -d postgres storage
sudo docker compose -f /opt/orbit/compose.yml ps
sudo docker compose -f /opt/orbit/compose.yml logs storage | grep 'created bucket'
```

两个服务都应为 healthy，日志里有 `created bucket orbit-attachments`。然后创建应用数据库账户：

```bash
sudo docker compose -f /opt/orbit/compose.yml exec postgres psql -U postgres
```

在 psql 中逐条执行，`\password` 输入两次应用数据库密码：

```sql
CREATE ROLE orbit_app LOGIN;
\password orbit_app
CREATE DATABASE orbit_prod OWNER orbit_app;
\q
```

以上只执行一次；已有数据库时不要重建。应用不使用 postgres 超级用户。

## 9. 迁移、检查存储并启动 web

**服务器 Bash：**

```bash
sudo docker compose -f /opt/orbit/compose.yml run --rm operations node node_modules/prisma/build/index.js migrate deploy
sudo docker compose -f /opt/orbit/compose.yml run --rm operations node --conditions=react-server --import tsx scripts/storage-check.ts
sudo docker compose -f /opt/orbit/compose.yml up -d web
sudo docker compose -f /opt/orbit/compose.yml ps
curl -i http://127.0.0.1:3000/health/ready
```

迁移应应用 16 个迁移；存储检查输出 `storage_check_passed`（它用应用自己的配置写入、读回并删除一个探针对象）；健康检查返回 HTTP 200。存储检查失败时按输出的 `stage` 和 `error` 排查：`SignatureDoesNotMatch` 表示两个文件里的存储密钥不一致，`NoSuchBucket` 表示桶名不是 `orbit-attachments`。503 表示数据库或迁移不可用，查看 `sudo docker compose -f /opt/orbit/compose.yml logs --tail=100 web postgres`。

## 10. Nginx 与 HTTPS

仓库的 [nginx-http.conf](../infra/nginx-http.conf)（http 上下文：限流区与脱敏日志格式）和 [nginx.conf](../infra/nginx.conf)（站点片段：安全头、请求体上限、认证限流与反向代理）直接使用，不在本文复制。

**服务器 Bash：**

```bash
ORBIT_HOST=YOUR_HOST
sudo install -m 644 /home/ubuntu/nginx-http.conf /etc/nginx/conf.d/orbit-logging.conf
sudo install -d /etc/nginx/snippets
sudo install -m 644 /home/ubuntu/nginx.conf /etc/nginx/snippets/orbit.conf
sudo tee /etc/nginx/sites-available/orbit > /dev/null <<EOF
server {
    listen 80 default_server;
    server_name ${ORBIT_HOST};
    include /etc/nginx/snippets/orbit.conf;
}
EOF
if [ "$(readlink -f /etc/nginx/sites-enabled/default)" = /etc/nginx/sites-available/default ]; then
  sudo unlink /etc/nginx/sites-enabled/default
fi
sudo ln -sf /etc/nginx/sites-available/orbit /etc/nginx/sites-enabled/orbit
sudo nginx -t
sudo systemctl reload nginx
curl -s -o /dev/null -w '%{http_code}\n' -H "Host: ${ORBIT_HOST}" http://127.0.0.1/health/ready
```

预期 `200`。再在电脑浏览器打开 `http://YOUR_HOST/health/ready`，确认主机名解析和公网访问都正常（Let's Encrypt 验证需要它），然后申请证书：

```bash
ORBIT_HOST=YOUR_HOST
sudo snap install --classic certbot
sudo /snap/bin/certbot --nginx -d "${ORBIT_HOST}"
sudo /snap/bin/certbot renew --dry-run
```

Certbot 按提示填写邮箱、接受条款，询问时选择把 HTTP 重定向到 HTTPS。它会把原站点改为监听 443 并保留 `include` 的全部设置。依据 [Certbot Nginx 说明](https://certbot.eff.org/instructions?os=snap&ws=nginx)。

sslip.io 由很多人共用，若 Let's Encrypt 报频率限制，可改用同一服务的 `nip.io` 形式（`203-0-113-5.nip.io`）：把 `ORBIT_HOST` 和 app.env 里的三个地址都换掉，执行 `sudo docker compose -f /opt/orbit/compose.yml up -d --force-recreate web` 后重新申请证书。

HSTS 暂不开启；有了自己的域名、确认整站 HTTPS 稳定后再加。

## 11. 验收与你自己的账户

1. 电脑浏览器打开 `https://YOUR_HOST/demo`，再用手机宽度看一次。
2. 在 `https://YOUR_HOST/auth/register` 注册你自己的账户。验证邮件不会到达（第一阶段预期如此），把这个邮箱手动标记为已验证：

```bash
sudo docker compose -f /opt/orbit/compose.yml exec -T postgres psql -U postgres -d orbit_prod -c "UPDATE \"User\" SET \"emailVerified\" = true WHERE email = 'YOUR_EMAIL';"
```

预期输出 `UPDATE 1`。只对你自己控制的邮箱这样做；配好邮件服务后不再需要。

3. 登录后创建项目和任务，切换列表/看板，写评论，上传并下载一份接近 10 MiB 的测试附件。
4. 执行 `sudo docker compose -f /opt/orbit/compose.yml restart web`，确认任务和附件仍在。
5. 查看资源和日志：

```bash
free -h
sudo docker stats --no-stream
sudo docker compose -f /opt/orbit/compose.yml logs --tail=100 web
```

注册后日志里出现 `auth_email_failed` 是第一阶段的预期现象。邀请第二个账户需要邮件，协作流程等配好邮件后再验收。

## 12. 维护与备份

### 定时维护

先只读预览：

```bash
sudo docker compose -f /opt/orbit/compose.yml run --rm operations
```

输出中 `maintenance_preview` 那一行的 `target` 是 64 位指纹。核对 `environment` 为 `production` 后，把它填进 app.env 的 `ORBIT_MAINTENANCE_TARGET=`。然后 `sudo crontab -e` 加入：

```cron
20 * * * * /usr/bin/flock -n /run/orbit-maintenance.lock /usr/bin/docker compose -f /opt/orbit/compose.yml run --rm operations node --conditions=react-server --import tsx scripts/maintenance-cleanup.ts --execute >> /var/log/orbit-maintenance.log 2>&1
```

数据库或存储配置变了，指纹也会变，需要重新预览并更新。

### 每日备份

[backup-local.sh](../infra/backup-local.sh) 先导出并校验数据库，再短暂停止存储服务，打包附件数据卷（期间 web 继续运行，附件请求返回 503），然后立即重启存储；两类文件各保留 7 天。任何一步失败都会返回非零，并保证存储服务被重新启动。

```bash
sudo /opt/orbit/backup-local.sh
sudo ls -lh /opt/orbit/backups
```

输出 `local_backup_complete` 后，`sudo crontab -e` 加入：

```cron
10 3 * * * /usr/bin/flock -n /run/orbit-backup.lock /opt/orbit/backup-local.sh >> /var/log/orbit-backup.log 2>&1
```

日志轮换：`sudo nano /etc/logrotate.d/orbit`：

```text
/var/log/orbit-maintenance.log /var/log/orbit-backup.log {
    weekly
    rotate 4
    compress
    missingok
    notifempty
    copytruncate
}
```

### 下载到电脑（每周一次，以及每次更新前）

**服务器 Bash：**

```bash
sudo sh -c 'install -o ubuntu -g ubuntu -m 600 "$(ls -t /opt/orbit/backups/orbit-*.dump | head -1)" /home/ubuntu/orbit-latest.dump'
sudo sh -c 'install -o ubuntu -g ubuntu -m 600 "$(ls -t /opt/orbit/backups/storage-*.tar.gz | head -1)" /home/ubuntu/storage-latest.tar.gz'
```

**Windows PowerShell：**

```powershell
$d = Get-Date -Format yyyyMMdd
New-Item -ItemType Directory -Force "$env:USERPROFILE\OrbitBackups" | Out-Null
scp -i "KEY_PATH" ubuntu@YOUR_IP:/home/ubuntu/orbit-latest.dump "$env:USERPROFILE\OrbitBackups\orbit-$d.dump"
scp -i "KEY_PATH" ubuntu@YOUR_IP:/home/ubuntu/storage-latest.tar.gz "$env:USERPROFILE\OrbitBackups\storage-$d.tar.gz"
```

下载完成后在服务器执行 `rm /home/ubuntu/orbit-latest.dump /home/ubuntu/storage-latest.tar.gz`。备份含用户数据，妥善保管。另外可以在 Oracle 控制台为启动卷手动创建卷备份（免费额度共 5 个），作为整机层面的补充，但它和实例在同一个账户里，不能代替下载到电脑。

### 恢复

上线后用合成数据做一次恢复演练。以下命令已在本地用同一编排验证过。数据库恢复到独立的检查库，不影响正式库：

```bash
sudo docker compose -f /opt/orbit/compose.yml exec -T postgres createdb -U postgres orbit_restore_check
sudo sh -c 'docker compose -f /opt/orbit/compose.yml exec -T postgres pg_restore -U postgres -d orbit_restore_check < "$(ls -t /opt/orbit/backups/orbit-*.dump | head -1)"'
```

核对后用 `dropdb -U postgres orbit_restore_check`（同样经 `exec -T postgres`）删除检查库。附件恢复会**用备份覆盖当前全部附件数据**，只在确实需要回滚时执行：

```bash
sudo docker compose -f /opt/orbit/compose.yml stop storage
sudo sh -c 'docker compose -f /opt/orbit/compose.yml run --rm --no-deps -T --user seaweed --entrypoint sh storage -c "find /data -mindepth 1 -delete && tar -xzf - -C /data" < "$(ls -t /opt/orbit/backups/storage-*.tar.gz | head -1)"'
sudo docker compose -f /opt/orbit/compose.yml start storage
```

不要运行 `docker compose down -v` 或卷清理命令：`pgdata` 与 `storagedata` 是正式数据。

## 13. 以后：域名、邮件、对象存储

- **域名**：DNS 添加 A 记录指向 `YOUR_IP`；把 Nginx 站点的 `server_name` 改为新域名，`sudo /snap/bin/certbot --nginx -d 新域名`；更新 app.env 的三个地址，执行 `sudo docker compose -f /opt/orbit/compose.yml up -d --force-recreate web`。已登录会话会失效。
- **邮件**：有了域名后可用 Oracle Email Delivery（Always Free 每月 3,000 封），按其文档验证发件域（SPF/DKIM）、登记发件地址、生成 SMTP 凭证，填入 app.env 的 `SMTP_*`（587 端口、`SMTP_SECURE=false`，应用会强制 STARTTLS），并重建 web 容器。
- **对象存储**：可迁到 Oracle Object Storage 的 S3 兼容接口（Always Free 20 GB、每月 5 万次请求）。先用兼容性探针实测，再按对象键原样复制现有附件，最后切换 `STORAGE_*` 并去掉 `local-storage` 配置；确认无误前保留 SeaweedFS 数据。

## 14. 更新应用

在 Windows 按第 6 节构建并上传新镜像（新的 `$sha` 标签，同时重新打 `showcase` 标签）。服务器上先执行一次 `sudo /opt/orbit/backup-local.sh` 并下载，然后：

```bash
sudo docker load -i /home/ubuntu/orbit-arm64.tar
sudo docker compose -f /opt/orbit/compose.yml stop web
sudo docker compose -f /opt/orbit/compose.yml run --rm operations node node_modules/prisma/build/index.js migrate deploy
sudo docker compose -f /opt/orbit/compose.yml up -d web
curl -i http://127.0.0.1:3000/health/ready
```

迁移失败时先排查，不要删除数据卷重试。回滚应用时用旧的 `$sha` 镜像重新打 `showcase` 标签，前提是它兼容当前数据库结构。

## 15. 常见问题

| 现象 | 优先检查 |
|---|---|
| SSH 超时 | 实例状态、公网 IP、安全列表的 22 端口 |
| 浏览器打不开 `http://YOUR_IP` | 安全列表的 80/443 入站规则、主机 iptables 顺序（第 4 节） |
| Certbot 失败 | 80 端口可达、`YOUR_HOST` 与公网 IP 对应、Let's Encrypt 频率限制（换 nip.io） |
| Nginx 502 | web 是否运行、`curl http://127.0.0.1:3000/health/ready`、容器日志 |
| ready 503 | PostgreSQL healthy、应用数据库密码、迁移是否完成 |
| 登录跳转到错误地址 | app.env 三个地址，修改后 `up -d --force-recreate web` |
| 附件失败 | `storage-check.ts` 输出、storage 是否 healthy、两份存储密钥是否一致 |
| 实例被停止 | Oracle 控制台通知与闲置回收规则（第 1 节）、从备份恢复 |

修改 app.env 后用 `sudo docker compose -f /opt/orbit/compose.yml up -d --force-recreate web` 生效；单纯 restart 不会更新容器环境变量。部署完成后把 `$sha`、访问地址、验收结果告诉维护者，记入发布报告。
