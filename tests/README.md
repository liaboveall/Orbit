# 测试

先按 [本地启动](../README.md#本地运行) 配置 PostgreSQL、SeaweedFS、Mailpit 和 .env.local。新开发卷会创建独立的 orbit_test。首次运行集成或浏览器测试前，将 DATABASE_URL 临时设为 TEST_DATABASE_URL，在 orbit_test 上运行 pnpm db:migrate:deploy，随后清除该临时覆盖。两者应指向不同数据库。主机端口覆盖见 [本地服务](../infra/README.md)。

| 命令 | 范围 |
| --- | --- |
| `pnpm check` | ESLint、类型、单元和契约测试 |
| `pnpm typecheck:scripts` | 维护脚本类型检查 |
| `pnpm test:integration` | 独立 PostgreSQL 上的授权、事务、并发与维护 |
| `pnpm test:e2e --retries=0` | 认证、协作、附件和错误恢复 |
| `pnpm test:ui --retries=0` | 真实项目上的响应式导航、面板、焦点和草稿保护 |

浏览器安装使用 pnpm exec playwright install chromium。Linux CI 使用 --with-deps。两套浏览器测试均启动 3100 端口的隔离生产构建，按测试所有权清理合成数据。集成测试与浏览器套件顺序运行，避免污染数据库指纹。报告、截图和 trace 写入 Git 忽略的 artifacts、test-results 与 playwright-report。

[CI 工作流](../.github/workflows/ci.yml) 还验证迁移历史、Nginx、镜像启动、镜像安全、备份一致性及隔离恢复。
