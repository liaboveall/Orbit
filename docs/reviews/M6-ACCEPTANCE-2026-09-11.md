# M6 本地实现与验收 · 2026-09-11

M6 当前为 **review**。本地实现与验收已完成；生产域名、托管服务、真实 HTTPS 双账户冒烟、备份/维护平台调度和远端 CI 尚待验收。没有发布生产站点，不将 M7 纳入本次范围。

## 交付内容

- ORB-020：保留 AC-01—11 回归，新增 1000 任务/子任务/评论、10 并发 HTTP 性能门禁，5 次 CPU 4x/40ms/10Mbps 工作台导航实验室采样，demo 三视口与工作台 axe 扫描。修复自定义字号被 tailwind-merge 错判为颜色导致按钮失去白色文字的问题。
- ORB-021：Node 24 digest 固定多阶段 Dockerfile、非 root standalone 运行、独立 operations 镜像、Compose/NGINX 模板、CI 工作流、live/ready 健康端点；PostgreSQL 原子共享限流、上传租约、限批维护与隔离数据库/MinIO 恢复演练。生产 HTTPS/同源环境校验、连接池 5、常见数据库连接故障映射为脱敏 503。
- ORB-022：公开 `/demo`（CAMP 24、PORT 12、COURSE 8 合成任务）支持搜索、列表/看板/活动、详情、只读写操作提示；无业务 API 调用。首页、真实截图、英文 README、架构图、既有三分钟演示脚本和运行手册已齐备。

关键文件：`src/server/modules/rate-limit/postgres.ts`、`attachments/postgres-gate.ts`、`maintenance/cleanup.ts`、`src/server/auth/options.ts`、`src/lib/cn.ts`、`src/features/demo/`、`Dockerfile`、`.github/workflows/ci.yml`、`scripts/recovery-drill.ts`、`scripts/container-smoke.mjs`、`README.en.md`、`docs/M6-OPERATIONS.md`。

## 实际验证

| 命令/验证 | 结果 |
|---|---|
| pnpm check | lint/typecheck、265 unit、137 contract 通过 |
| 新增 m6-production + design-classes 定向单测 | 2 通过（含新增 1 项故障映射测试） |
| pnpm typecheck:scripts | 通过 |
| pnpm test:integration | 308 通过，含双独立数据库池的原子限流和上传租约竞争 |
| pnpm test:e2e --retries=0 | 70 通过，独立正式构建服务 |
| pnpm test:ui --retries=0 | 13 通过 |
| E2E/UI 两库内容指纹 | 精确夹具清理后均一致 |
| pnpm audit --prod --audit-level=high | No known vulnerabilities found |
| Docker runner/operations 构建 | 通过；runner 实际运行验证 ready、demo、非 root、无构建环境文件 |
| migrate deploy | 开发库与 orbit_test 均应用第 14 个迁移 shared_admission |
| recovery-drill | 临时源库全量迁移、pg_dump/pg_restore、MinIO 恢复及 SHA-256 验证；过期桶/租约维护重复执行验证通过 |

原始日志：`artifacts/m6-check.log`、`m6-integration.log`、`m6-e2e-final.log`、`m6-ui.log`、`m6-docker.log`、`m6-operations-image.log`、`m6-audit.log`。结构化测量：`artifacts/release/performance.json`、`recovery.json`。可追踪截图：`public/screenshots/demo.png`、`workbench.png`。

## 性能与可访问性

本机 Windows，i9-13980HX、约 31.7 GiB RAM、Node 26.8.1、Chromium 153.0.8010.12，独立正式构建、Docker PostgreSQL。每项目 1000 任务、1000 子任务、1000 评论。

- 10 并发：100 次 JSON 列表读取 p95 **62.13ms**，40 次任务更新 p95 **127.91ms**，错误率 **0**。
- 首个看板 JSON **87,111 bytes**，低于 250 KiB 预算。
- 1440px、CPU 4x、40ms 网络延迟、10Mbps 下行/5Mbps 上行、清空 HTTP 缓存，5 次导航到工作台标题可见且导航可聚焦：中位 **560ms**，范围 **551–747ms**。
- demo 390/768/1440 与真实工作台 axe critical/serious 为 0。截图已实际查看，公开数据明确标识；既有键盘/弹层/移动端回归通过。
- 上述为本机实验室数据，不是 INP/LCP/CLS 真实用户第 75 分位，也不代表生产可承载流量。

## 恢复与失败记录

隔离演练恢复成员、任务 version=3、评论、活动与样例文本附件；恢复步骤约 **0.32 秒**，全程约 **6.10 秒**，备份约 50 KiB。临时数据库与对象按本次精确标识清理，未恢复覆盖用户数据库。生产 RPO/RTO 仍待实际平台验证。

首次 Docker 构建因缺少 public 目录失败，已修正。首次浏览器扫描发现按钮对比度问题，修复公共 class 合并器后通过。首次性能测试定位了不存在的导航链接而超时；其 1000 任务夹具按精确项目 ID 定位清理，随后改用真实任务分类导航，并增加 afterEach 清理，重跑和最终全量套件均通过且两库指纹一致。失败不计为通过。

## 外部待验收与下一步

提交并运行远端 CI；提供服务器/容器平台、域名、PostgreSQL、私有 S3、生产 SMTP 配置位置，然后按 [运行手册](../M6-OPERATIONS.md) 完成 staging、备份点、一次性迁移、生产部署、HTTPS 双账户冒烟、每日维护与备份调度及告警。待这些证据齐备后再将 M6/ORB-021 置为 done。
