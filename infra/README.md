# infra · 本地编排与部署

| 文件 | 用途 |
|---|---|
| `compose.dev.yml` | 本地开发依赖：PostgreSQL 17（5432）、MinIO（9000/9001）、Mailpit（SMTP 宿主 25025 → 容器 1025 / Web 8025）。全部只绑 127.0.0.1。 |
| `postgres/init/01-create-test-db.sql` | 容器首次初始化时创建独立测试库 `orbit_test`（与 `orbit_dev` 隔离）。 |

启动 / 停止：

```bash
docker compose -f infra/compose.dev.yml up -d      # 起库
docker compose -f infra/compose.dev.yml down        # 停止（保留数据卷）
docker compose -f infra/compose.dev.yml down -v      # 停止并清空数据卷
```

> 生产 Dockerfile、多阶段构建与部署编排属 **M6（ORB-021）**，见 docs/08 §4，本目录 M0 不含。
> MinIO bucket 创建与附件联调属 M5（ORB-018）；Mailpit 邮件流程属 M1（ORB-005）。
