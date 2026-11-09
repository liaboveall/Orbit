# tests · 测试与验收

| 目录 | 命令 | 覆盖范围 |
|---|---|---|
| unit | `pnpm test:unit` | 输入校验、游标、草稿、IP、排序等纯逻辑 |
| contract | `pnpm test:contract` | OpenAPI / Zod、响应形状与 M0–M4 HTTP 路由导出 |
| integration | `pnpm test:integration` | 独立 PostgreSQL 上的 API、权限、事务、并发与维护脚本 |
| e2e | `pnpm test:e2e --retries=0` | 真实认证、项目、任务、邀请、成员与失败恢复 |
| ui | `pnpm test:ui --retries=0` | 响应式导航、弹层、键盘焦点、草稿保护 |

`pnpm check` 包含 lint、typecheck、unit、contract；集成测试、浏览器测试和
`pnpm typecheck:scripts` 单独运行。最新实际结果见
[当前验证状态](../PROGRESS.md)。

E2E 先生产构建，UI 为验证开发专用样例页使用 dev 模式；两者均由 runner 启动 3100 端口的独立测试服务，连接 orbit_test。
`E2E_BASE_URL` 外部服务复用已禁用，不能指向日常开发服务。UI 继承相同隔离配置。
集成与两套浏览器测试均精确清理夹具，并在结束时核对开发库、测试库内容指纹。
数据库集成与浏览器套件顺序执行，避免同时修改测试库造成隔离校验冲突。

浏览器安装：`pnpm exec playwright install --with-deps chromium`。
截图、trace 等运行产物在 `test-results/`；正式验收日志在 `artifacts/`。
连接、环境变量和清理规则见 [环境文档](../docs/08-ENVIRONMENT-AND-DEPLOYMENT.md)。

Mailpit 端口被 Windows 保留时，用 MAILPIT_SMTP_HOST_PORT/MAILPIT_WEB_HOST_PORT 调整 Compose 宿主端口，并同步 SMTP_PORT/MAILPIT_API。auth-flow 使用统一 MAILPIT_API；不需要改测试代码或断言。生产配置回归 production-read.test.ts 使用真实会话和 PostgreSQL，但不替代真实 HTTPS 传输与云部署验收。

备份并发回归：`node scripts/verify-local-backup.mjs` 创建独立 Compose 项目和卷，冻结存储期间验证对象删除失败，恢复快照 READY 记录及原始对象。需要 Docker socket、本地容器和包下载网络；不使用 .env 或现有卷，结束仅删除本次合成资源。冻结门禁和 CI 均执行。
