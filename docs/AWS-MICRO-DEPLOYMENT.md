# Orbit AWS 部署指南：先用 t3.micro，不足再升级 small

更新：2026-09-12。用途：个人全栈作品与简历演示。本文是操作指南，尚未在你的 AWS 实例执行；micro 的容量仍需部署后验证。


## 1. 本次采用的方案

一台 Ubuntu EC2 同时运行 Nginx、Docker 中的 Orbit 和 PostgreSQL；附件放私有 S3，邮件通过 SES。先选 t3.micro（2 vCPU / 1 GiB），加 2 GiB swap；不足再将原实例改成 t3.small（2 GiB）。镜像在 Windows 电脑构建，服务器不跑构建或测试。

浏览器 → HTTPS Nginx → Orbit → 同机 PostgreSQL；Orbit → S3 / SES。

不需要 RDS、负载均衡、NAT Gateway 或 Kubernetes。此方案按用户的个人展示用途简化：同机数据库通过 Docker 私网连接，不采用原运行手册的远端托管数据库方案。它存在单机故障风险，备份需要自己维护。swap 是磁盘上的应急空间，不能代替真正内存。

## 2. 准备信息

全文示例需要替换：

| 示例 | 替换为 |
|---|---|
| `YOUR_EC2_IP` | 实例公网 IPv4 / Elastic IP |
| `orbit.example.com` | 你的应用域名 |
| `example.com` | 你控制 DNS 的根域名 |
| `YOUR_BUCKET_NAME` | 唯一的 S3 bucket 名称 |
| `REPLACE_...` | 对应真实密码或凭证，仅填服务器环境文件 |

需要 AWS 账户、能修改 DNS 的域名、Windows 上可工作的 Docker Desktop，以及本仓库。没有域名时先完成实例和镜像准备；正式认证配置使用 HTTPS 域名。

文中的 **Windows PowerShell** 命令在电脑执行；**服务器 Bash** 命令在 SSH 登录后执行。不要混用。

## 3. 创建 EC2

AWS 控制台选择 Singapore（ap-southeast-1），进入 EC2 → Instances → Launch instances：

1. 名称：`orbit-showcase`。
2. 系统：普通 Ubuntu Server 24.04 LTS，64-bit x86，避免误选 Ubuntu Pro 或 ARM。
3. 类型：`t3.micro`。
4. 创建 RSA 密钥对，下载 `.pem`，妥善保存在 `C:\Users\Mars\.ssh\orbit-showcase.pem`。不提交到 Git。
5. 使用默认 VPC、有公网路由的子网，启用公网 IPv4。
6. 新建安全组：SSH 22 来源选 My IP；HTTP 80、HTTPS 443 来源 `0.0.0.0/0`。数据库 5432、应用 3000 不开放公网。
7. 磁盘选 30 GiB gp3，启用加密；无需另加数据盘。
8. 启动后等状态检查通过。已有符合配置的实例可直接复用，不必重复创建。

建议在 EC2 → Elastic IP addresses 分配一个地址并关联此实例，便于以后升级保持域名指向不变。公网 IPv4 有费用，Elastic IP 不是免费资源。

到域名 DNS 控制台新增 A 记录：`orbit` → 实例 Elastic IP，TTL 可设 300。先使用直接 DNS 解析，不增加 CDN 代理层。若已有错误 AAAA 记录，修正后再申请证书。

**Windows PowerShell：**

```powershell
ssh -i "C:\Users\Mars\.ssh\orbit-showcase.pem" ubuntu@YOUR_EC2_IP
```

首次连接核实目标后接受主机指纹。超时优先检查实例状态、安全组 My IP 与公网地址。

## 4. 为 micro 配置 swap

**服务器 Bash：** 先检查，已有 swap 时不要重复创建或覆盖文件。

```bash
free -h
swapon --show
ls -l /swapfile
df -h /
```

新实例没有 swap、`/swapfile` 不存在且磁盘余量充足时，执行一次：

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-orbit-swap.conf
sudo sysctl --system
swapon --show
free -h
```

预期 swap 总量约 2 GiB。最后两条可重复检查，其余初始化命令不要重复执行。暂不设置武断的容器硬内存上限，先观察实际使用。

## 5. 安装 Docker 与 Nginx

以下适用于新建的 Ubuntu 24.04 实例。已有 Docker 时先运行 `docker --version` 和 `docker compose version`，避免重复替换安装。

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
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker nginx
sudo docker run --rm hello-world
sudo docker compose version
sudo nginx -t
```

安装方式依据 [Docker Ubuntu 官方文档](https://docs.docker.com/engine/install/ubuntu/)。

## 6. 创建私有 S3 与应用凭证

1. S3 → Create bucket，区域 Singapore，General purpose，填唯一名称。
2. Object Ownership 保持 ACL disabled；Block all public access 全部启用。
3. 开启 Versioning（备份桶生命周期中的 NoncurrentVersionExpiration 依赖它：旧版本
   保留 7 天后过期，关闭 Versioning 会让该规则失效、只保留当前对象），默认加密选择
   SSE-S3。无需静态网站托管或浏览器 CORS。
4. Bucket → Management → Create lifecycle rule，应用到整个 bucket：非当前版本在 **30 天**后永久删除；清理过期删除标记；终止 **1 天**前未完成的 multipart upload。不要设置当前版本到期删除，也不要设置保留版本数量条件。规则对应仓库 [s3-lifecycle.json](../infra/s3-lifecycle.json)，两条规则均启用。历史版本在 30 天内仍计费，该窗口覆盖 7 天数据库备份；更长备份需同步延长版本保留。
5. IAM → Policies → Create policy → JSON，填下方策略，替换 bucket 名。

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
  }]
}
```

5. 创建 IAM 用户 `orbit-showcase-storage`，不开控制台登录，仅绑定上述策略。
6. 在该用户 Security credentials 中创建 Access key，安全保存 ID 和 Secret。

当前代码显式读取静态存储凭证，因此本文使用限定 bucket 权限的 IAM 用户；仅给 EC2 挂角色并不能替代当前代码要求的环境变量。不要使用 root access key。凭证只放服务器环境文件，不发到聊天或 Git。

## 7. 配置 SES 邮件

1. 在 Singapore 区域打开 SES → Verified identities → Create identity → Domain，填写你的根域名。
2. 按页面给出的记录配置 DNS/DKIM，等待身份验证成功。
3. 创建 SMTP credentials，保存 SMTP username/password；它们不是上一步 S3 的 access key。
4. SMTP 主机用 `email-smtp.ap-southeast-1.amazonaws.com`，端口 587，应用 `SMTP_SECURE=false` 表示建立连接后使用 STARTTLS。
5. 初次账户通常在 sandbox。在 Verified identities 中再验证你控制的两个收件邮箱，用它们完成注册与邀请演示。

Sandbox 下不能向任意未验证收件人发信；如果要让招聘方自行注册，需要申请 production access 并获批。公开 `/demo` 无需注册，可先作为简历入口。参见 [SES sandbox 与生产权限](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)。

## 8. 本地构建并上传镜像

**Windows PowerShell：** 启动 Docker Desktop，进入仓库。使用包含 M6 Dockerfile 的当前工作版本；不要为了部署强行切分支覆盖未提交改动。

```powershell
Set-Location D:\FullStack\Orbit
git status --short
git branch --show-current
docker build --platform linux/amd64 --target runner -t orbit-web:showcase .
docker build --platform linux/amd64 --target operations -t orbit-operations:showcase .
New-Item -ItemType Directory -Force artifacts
docker save -o artifacts/orbit-showcase.tar orbit-web:showcase orbit-operations:showcase
scp -i "C:\Users\Mars\.ssh\orbit-showcase.pem" artifacts/orbit-showcase.tar ubuntu@YOUR_EC2_IP:/home/ubuntu/orbit-showcase.tar
```

每条构建必须成功再继续。`operations` 镜像用于迁移和维护，体积较大，上传可能需要几分钟。本仓库 Dockerfile 构建时使用示例配置，正式密钥在运行时注入。

**服务器 Bash：**

```bash
sudo docker load -i /home/ubuntu/orbit-showcase.tar
sudo docker image ls
sudo install -d -m 700 /opt/orbit
sudo touch /opt/orbit/app.env /opt/orbit/db.env
sudo chmod 600 /opt/orbit/app.env /opt/orbit/db.env
```

## 9. 数据库与 Compose

生成一份数据库管理员密码，保存到自己的密码管理器：

```bash
openssl rand -hex 24
sudo nano /opt/orbit/db.env
```

填写（替换占位值）：

```dotenv
POSTGRES_USER=postgres
POSTGRES_PASSWORD=REPLACE_DB_ADMIN_PASSWORD
POSTGRES_DB=postgres
```

nano 保存用 Ctrl+O、Enter，退出用 Ctrl+X。再执行 `sudo nano /opt/orbit/compose.yml`，填写：

```yaml
name: orbit-showcase
x-logging: &logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
services:
  postgres:
    image: postgres:17
    restart: unless-stopped
    env_file: [/opt/orbit/db.env]
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d postgres"]
      interval: 5s
      timeout: 5s
      retries: 12
    logging: *logging
  web:
    image: orbit-web:showcase
    restart: unless-stopped
    init: true
    env_file: [/opt/orbit/app.env]
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
    security_opt: [no-new-privileges:true]
    cap_drop: [ALL]
    stop_grace_period: 150s
    logging: *logging
  operations:
    image: orbit-operations:showcase
    profiles: [tools]
    init: true
    env_file: [/opt/orbit/app.env]
    depends_on:
      postgres:
        condition: service_healthy
    security_opt: [no-new-privileges:true]
    cap_drop: [ALL]
    logging: *logging
volumes:
  pgdata:
```

这是本文独立的单机 Compose，不要直接使用仓库里只包含应用服务的 `infra/compose.production.yml`。

```bash
sudo docker compose -f /opt/orbit/compose.yml config --quiet
sudo docker compose -f /opt/orbit/compose.yml up -d postgres
sudo docker compose -f /opt/orbit/compose.yml ps
openssl rand -hex 24
```

最后生成的是另一份应用数据库密码，请保存。数据库 healthy 后进入 SQL：

```bash
sudo docker compose -f /opt/orbit/compose.yml exec postgres psql -U postgres
```

在 psql 中逐条执行：

```sql
CREATE ROLE orbit_app LOGIN;
\password orbit_app
CREATE DATABASE orbit_prod OWNER orbit_app;
\q
```

`\password` 会提示输入两次刚生成的应用数据库密码。应用不使用 postgres 超级用户。上述创建语句只执行一次；已有数据库时不要重建。修改 db.env 不会自动改变已初始化数据库的密码。

## 10. 填写正式环境变量

```bash
openssl rand -hex 32
sudo nano /opt/orbit/app.env
```

将刚生成的值用于 `BETTER_AUTH_SECRET`。填写下方内容并替换所有占位符：

```dotenv
APP_ENV=production
APP_URL=https://orbit.example.com
BETTER_AUTH_URL=https://orbit.example.com
AUTH_TRUSTED_ORIGINS=https://orbit.example.com
BETTER_AUTH_SECRET=REPLACE_AUTH_SECRET
DATABASE_URL=postgresql://orbit_app:REPLACE_APP_DB_PASSWORD@postgres:5432/orbit_prod
TEST_DATABASE_URL=postgresql://unused:unused@127.0.0.1:5432/orbit_test
SMTP_HOST=email-smtp.ap-southeast-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=REPLACE_SES_SMTP_USERNAME
SMTP_PASSWORD=REPLACE_SES_SMTP_PASSWORD
SMTP_SECURE=false
MAIL_FROM="Orbit <no-reply@example.com>"
STORAGE_ENDPOINT=https://s3.ap-southeast-1.amazonaws.com
STORAGE_REGION=ap-southeast-1
STORAGE_BUCKET=YOUR_BUCKET_NAME
STORAGE_ACCESS_KEY_ID=REPLACE_S3_ACCESS_KEY_ID
STORAGE_SECRET_ACCESS_KEY=REPLACE_S3_SECRET_ACCESS_KEY
STORAGE_FORCE_PATH_STYLE=false
# D1 修复：生产必须 ≥1（=Nginx 受信代理层数，本机同机单层即 1）。
# 应用启动期校验：production + TRUSTED_PROXY_COUNT=0 会拒绝启动（限流会塌缩为全局单桶）。
TRUSTED_PROXY_COUNT=1
LOG_LEVEL=info
AI_ENABLED=false
```

三个应用地址保持完全一致，无尾部斜杠。数据库密码使用前面生成的 hex，避免 URL 特殊字符问题。TEST_DATABASE_URL 仅满足配置校验，正式服务不连接它，也不需要创建测试库。服务器不执行 seed、开发迁移、恢复演练脚本或测试命令。

Compose 环境文件支持插值：若自选密码包含 `$`，用单引号包住完整值以保留字面量；本文随机 hex 密码无需此处理。

## 11. 迁移并启动

```bash
sudo docker compose -f /opt/orbit/compose.yml config --quiet
sudo docker compose -f /opt/orbit/compose.yml run --rm operations pnpm db:migrate:deploy
sudo docker compose -f /opt/orbit/compose.yml up -d web
sudo docker compose -f /opt/orbit/compose.yml ps
curl -i http://127.0.0.1:3000/health/ready
```

迁移成功再启动 web；健康端点预期 HTTP 200。503 表示数据库或迁移尚不可用。排查使用：

```bash
sudo docker compose -f /opt/orbit/compose.yml logs --tail=100 web postgres
free -h
```

micro 上首次迁移可先只运行数据库，避免迁移与 web 同时占用内存。

## 12. 域名、Nginx 与 HTTPS

```bash
sudo nano /etc/nginx/conf.d/orbit-logging.conf
```

先把仓库 `infra/nginx-http.conf` 的全部内容复制到 `/etc/nginx/conf.d/orbit-logging.conf`（http 上下文自动加载）。它只记录时间、请求 ID、固定标签的路由类别/方法、状态、字节数和耗时，不包含 URL、路径、查询或 Referer。保存后创建站点配置：

```bash
sudo nano /etc/nginx/sites-available/orbit
```

填写并替换域名：

```nginx
server {
    listen 80 default_server;
    server_name orbit.example.com;
    access_log /var/log/nginx/orbit-access.log orbit_safe;
    error_log /dev/null;
    add_header Referrer-Policy no-referrer always;
    add_header X-Content-Type-Options nosniff always;
    add_header Content-Security-Policy "frame-ancestors 'none'" always;
    # HTTPS 终结后按需追加 HSTS（先完成整站 HTTPS 验收，避免锁死明文调试）：
    # add_header Strict-Transport-Security "max-age=15552000" always;
    client_max_body_size 12m;
    # D4 修复：认证端点专用 64k 预算（与仓库 infra/nginx.conf 同步；复制 location 时
    # 必须连同上方安全头与 proxy_set_header 一起继承）。
    location /api/auth/ {
        client_max_body_size 64k;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Request-Id $request_id;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 150s;
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Request-Id $request_id;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 150s;
    }
}
```

```bash
# 本文的新 EC2 只部署 Orbit；停用 Ubuntu 默认站点的软链接，保留源文件。
if [ "$(readlink -f /etc/nginx/sites-enabled/default)" = /etc/nginx/sites-available/default ]; then
  sudo unlink /etc/nginx/sites-enabled/default
fi
sudo ln -s /etc/nginx/sites-available/orbit /etc/nginx/sites-enabled/orbit
sudo nginx -t
sudo systemctl reload nginx
sudo snap install --classic certbot
sudo /snap/bin/certbot --nginx -d orbit.example.com
sudo /snap/bin/certbot renew --dry-run
```

Nginx 的原始 error log 无法脱敏，可能包含请求令牌，因此此虚拟主机定向 `/dev/null`；故障诊断使用安全访问日志中的状态/耗时及应用结构化错误。Certbot 配置后检查 HTTP 和 HTTPS 两个 server 都保留这些日志设置，不能再继承默认 combined。Orbit 必须是该专用服务器 80/443 的默认站点，保证未知 Host 和请求解析错误也不会落到另一个默认日志配置；若以后新增站点，所有默认虚拟主机都要采用同一日志策略。不要开启记录完整 URL 的第三方访问日志。

软链接只需创建一次。Certbot 按提示填写邮箱、接受条款，选择 HTTPS 重定向（若询问）。申请前确认域名已解析到该实例且 80/443 对公网开放。参见 [Certbot Nginx 配置](https://certbot.eff.org/instructions?os=snap&ws=nginx)。

在电脑浏览器访问 `https://orbit.example.com/demo` 和首页。不要将正式 APP_URL 改为 HTTP 来绕过认证配置。

## 13. 验收：micro 是否够用

先打开监控：

```bash
free -h
sudo docker stats --no-stream
vmstat 1 10
sudo journalctl -k --since "1 hour ago" | grep -Ei 'out of memory|oom|killed process'
```

依次用两个本人控制的邮箱验证：

- 首页与 `/demo` 正常，手机宽度也能浏览。
- 注册、收验证码/验证邮件、登录和退出。
- 创建项目、任务、切换列表/看板、评论。
- 邀请第二个账户，接受邀请并协作。
- 上传、下载一份接近应用 10 MiB 上限的测试附件。
- 移除成员后，该成员不能访问原项目资源。
- 重启 web 容器后，任务与附件仍可访问。

记录日期、镜像版本、是否有失败。观察 `free` 的 available，而不只看 free；缓存占用并不等于内存不足。少量 swap 使用不一定有问题，但持续大量 swap 读写（vmstat 的 si/so）、明显卡顿、OOM 或容器反复重启，说明需要升级或排查。

**升级判断：** 同样操作持续触发 OOM，或低并发下经常因换页明显卡顿，就升级 small。单次邮件失败或 502 不必直接归因于实例大小，先查日志。不要在 micro 上跑完整 E2E 或千任务压力测试。

## 14. 维护与备份

手动验证维护：

```bash
sudo docker compose -f /opt/orbit/compose.yml run --rm operations pnpm maintenance:cleanup
```

成功后运行 `sudo crontab -e`，添加一行（按服务器时区执行，可用 `timedatectl` 查看）：

```cron
20 * * * * /usr/bin/flock -n /run/orbit-maintenance.lock /usr/bin/docker compose -f /opt/orbit/compose.yml run --rm operations pnpm maintenance:cleanup >> /var/log/orbit-maintenance.log 2>&1
```

每小时运行，flock 防止重叠；每轮每表最多处理 10 批 × 1000 行，达到上限会返回非零并标记 saturated，需要检查积压并缩短调度间隔。附件清理失败同样返回非零。定期检查日志。给宿主日志配置轮换：`sudo nano /etc/logrotate.d/orbit`，填写：

```text
/var/log/orbit-maintenance.log {
    weekly
    rotate 4
    compress
    missingok
    notifempty
    copytruncate
}
```

首次上线、重要数据变更后和升级前执行数据库备份：

```bash
sudo install -d -m 700 /opt/orbit/backups
sudo sh -c 'umask 077; docker compose -f /opt/orbit/compose.yml exec -T postgres pg_dump -U postgres -Fc orbit_prod > "/opt/orbit/backups/orbit-$(date +%F-%H%M%S).dump"'
sudo ls -lh /opt/orbit/backups
```

确保命令退出成功，备份非空。选择刚生成的真实文件名，将备份复制到 ubuntu 可读的临时位置（以下日期是占位示例）：

```bash
sudo install -o ubuntu -g ubuntu -m 600 /opt/orbit/backups/orbit-YYYY-MM-DD-HHMMSS.dump /home/ubuntu/orbit-backup.dump
```

**Windows PowerShell：**

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\OrbitBackups"
scp -i "C:\Users\Mars\.ssh\orbit-showcase.pem" ubuntu@YOUR_EC2_IP:/home/ubuntu/orbit-backup.dump "$env:USERPROFILE\OrbitBackups\orbit-backup.dump"
```

每次下载后改为带日期的文件名，避免覆盖唯一备份。数据库 dump 包含用户数据，妥善保管。服务器上的同盘备份不足以应对磁盘损坏；S3 versioning 也不是数据库备份。按下方配置每日自动异地备份；只有实际备份成功并完成隔离恢复演练后，才可标记生产备份验收完成。

### 每日自动异地数据库备份

1. 创建**独立**私有 S3 备份 bucket，阻止全部公开访问、SSE-S3 加密。应用附件 bucket 不要套用数据库到期规则。备份 bucket 配置 [s3-backup-lifecycle.json](../infra/s3-backup-lifecycle.json)：`database/` 当前备份 7 天后到期，非当前版本另保留 7 天。
2. 创建备份专用 IAM 身份，仅授予 `s3:PutObject`、`s3:GetObject`、`s3:AbortMultipartUpload` 到 `arn:aws:s3:::YOUR_BACKUP_BUCKET/database/*`。不要复用应用存储凭证；不要授予删除权限。
3. 按 [AWS CLI v2 Linux 官方安装步骤](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) 在 EC2 安装并运行 `aws --version`。执行 `sudo aws configure --profile orbit-backup`，在交互提示中填写备份专用凭证和区域，不把密钥写入命令历史。此身份只用于备份。
4. 将仓库 `infra/backup-database.sh` 上传到服务器，执行 `sudo install -o root -g root -m 700 backup-database.sh /opt/orbit/backup-database.sh`。用 `sudo nano /etc/orbit-backup.env` 填写：

```bash
ORBIT_BACKUP_BUCKET=YOUR_BACKUP_BUCKET
AWS_PROFILE=orbit-backup
```

```bash
sudo chmod 600 /etc/orbit-backup.env
sudo /opt/orbit/backup-database.sh
```

脚本检查 dump 非空及可读取目录，上传至 S3 后核对长度；失败立即返回非零。备份内容本身要通过下方恢复验收，不能只凭文件大小判断可恢复。脚本在成功异地复制后清理本脚本产生的 7 天以上本地备份。

5. 确认手动成功后，在 `sudo crontab -e` 加入：

```cron
10 3 * * * /usr/bin/flock -n /run/orbit-backup.lock /opt/orbit/backup-database.sh >> /var/log/orbit-backup.log 2>&1
```

将 `/var/log/orbit-backup.log` 加入前述 logrotate 规则。检查次日出现 `database_backup_complete`，在 S3 控制台核对对象 Last modified 距今不超过 24 小时。cron 配置不等于已实现告警：服务器监控还需检查备份失败/超过 24 小时无新对象，并由你设置通知渠道。

6. 上线前用本人合成数据，在**独立恢复数据库**恢复一次最新 dump，核对任务、成员、评论和附件。附件被删除时，从其版本历史恢复对应 VersionId；30 天历史窗口覆盖数据库 7 天备份。记录备份时间、恢复耗时和下载文件摘要。仓库 `scripts/recovery-drill.ts` 仅限本机隔离测试库，不能直接指向生产，也不要用 `pg_restore --clean` 覆盖正式库。生产 RPO/RTO 仍需实际测量。

不要运行 `docker compose down -v` 或卷清理命令，`pgdata` 是正式数据。

## 15. 不够用时原机升级到 t3.small

无需重装 Ubuntu 或重新建数据库。以下针对本文的 EBS 按需 t3 实例：

1. 按上一节备份数据库并下载到电脑。也可先为 EBS 创建快照。
2. 在服务器执行 `sudo docker compose -f /opt/orbit/compose.yml stop`，等待正常停止。
3. AWS EC2 → Instances → 选中实例 → Instance state → **Stop instance**，不要选 Terminate。
4. 等状态变为 Stopped。
5. Actions → Instance settings → Change instance type → 选择 `t3.small` → 保存。
6. Instance state → Start instance，等待状态检查通过。
7. 使用 Elastic IP 时地址保持不变；若原来是自动公网 IP，检查新地址并修改域名 A 记录和 SSH 目标。
8. SSH 登录，检查并启动：

```bash
free -h
swapon --show
sudo docker compose -f /opt/orbit/compose.yml up -d postgres web
sudo docker compose -f /opt/orbit/compose.yml ps
curl -i http://127.0.0.1:3000/health/ready
```

9. 浏览器验证 HTTPS、登录、任务和附件。无需因更换实例大小重跑数据库初始化或迁移。保留 2 GiB swap 即可。

原 EBS、配置、Docker 镜像与卷会保留。变更需要停机；普通公网 IP 在停止/启动后可能变化。依据 [AWS 更改实例类型](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/change-instance-type-of-ebs-backed-instance.html)。

## 16. 后续更新应用

在 Windows 构建并上传两份匹配的新镜像，建议改用日期或 commit 标签保留旧版。服务器加载后备份数据库，修改 compose 的两个 image 标签；在 micro 上先停止 web，再执行迁移，成功后启动 web 并做健康检查。迁移失败时先排查，不删除数据卷重试。回滚应用前需确认旧镜像兼容当前数据库结构。

## 17. 费用与常见问题

按先前截图 Linux 价格、730 小时估算：micro 计算约 $9.64/月，small 约 $19.27/月；这是截图价格估算，不是完整账单或当前报价承诺。EBS、公网 IPv4、S3、SES、快照和可能的 T3 Unlimited 额外 CPU credit 费用需另算。没有流量仍有固定资源费用。

在 AWS Billing 查看 Credits 剩余额度/有效期，并设个人可接受的月度预算提醒；预算提醒不是自动停费上限。“符合免费套餐”不等于所有资源不扣额度。

| 现象 | 优先检查 |
|---|---|
| SSH 超时 | 公网 IP、My IP 安全组、实例检查 |
| Nginx 502 | web 是否运行、localhost:3000 健康检查、容器日志 |
| ready 503 | PostgreSQL healthy、数据库密码、迁移是否成功 |
| 登录跳转 localhost | app.env 三个域名值，修改后重建 web 容器 |
| 邮件不来 | SES 区域、SMTP 凭证、sandbox 收件人验证、垃圾箱 |
| 附件失败 | bucket 区域、IAM 对象权限、S3 凭证、文件大小 |
| Certbot 失败 | A/AAAA 记录、80 端口、Nginx 配置 |
| 容器频繁重启 | OOM 日志、available 内存、swap 与磁盘剩余空间 |

修改 app.env 后用 `sudo docker compose -f /opt/orbit/compose.yml up -d --force-recreate web` 应用新环境；单纯 restart 不会更新容器环境变量。

简历优先放公开只读 `/demo`；面试时用你自己的账户演示真实协作。不要公开共享可写账号密码。
