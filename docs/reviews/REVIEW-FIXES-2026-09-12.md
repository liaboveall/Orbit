# Orbit 上线前审查问题修复与验收 · 2026-09-12

## 交付结论

[本轮审查](PROJECT-DEEP-REVIEW-2026-09-12.md) 的 **R12-01–R12-07 共 7 项问题已完成仓库修复与本地回归验收**。同时处理评论加载成本、日志级别、维护积压、自动备份配置与文档漂移。M1/M5 恢复 done；M6 保持 review，等待实际 AWS 部署和生产验收；M7 未启动。

本轮没有登录 AWS、变更真实服务器、上传生产数据、提交或推送代码。配置修复已进入仓库和指南，不表示用户服务器已经应用。原有未提交的指南与交接文档在此基础上更新。

## 逐项关闭证据

| 编号 | 最终行为与关键文件 | 实际验证 |
|---|---|---|
| R12-01 / P1 | [nginx-http.conf](../../infra/nginx-http.conf) 使用固定类别的 route/method，记录 requestId/status/bytes/duration，不记录路径、查询、Referer。 [nginx.conf](../../infra/nginx.conf) 启用安全日志、覆盖上游请求 ID，原始 error log 定向 /dev/null；Next 全站 no-referrer。指南覆盖默认站点和 Certbot 后复核。 | 真实 Nginx 容器语法通过；4 次合成请求覆盖成功 200、上游失败 502、查询令牌、路径令牌及 Referer，访问日志没有秘密。 |
| R12-02 / P2 | [email.ts](../../src/server/auth/email.ts) 在 staging/production 强制 TLS，587 必须成功 STARTTLS；保留开发/测试 Mailpit 明文能力。SMTP 错误转换为固定文案，认证库日志不记录原始参数。 | 真实本机 SMTP 服务不提供 STARTTLS，生产发送失败，未发送 AUTH；正常 Mailpit 全流程与既有邮件回归通过。 |
| R12-03 / P2 | [attachment-list.tsx](../../src/features/tasks/attachments/attachment-list.tsx) 将首次读取错误与后台刷新错误分开；后台错误和重试保留列表、UploadButton 与文件。403/404 仍撤掉失权内容。 | 浏览器选择文件后注入 GET 503，文件在错误和重试后保留；另一用例挂起真实上传请求，触发 GET 503，上传组件保持，恢复请求后得到 201。 |
| R12-04 / P2 | 子任务新增/编辑、评论新增/编辑忽略 isComposing 或兼容 keyCode 229 的快捷操作，并阻止组合事件向外层弹窗传播。 | 新增子任务组合 Enter/Escape 不提交或清空，普通 Enter 创建成功；子任务和评论编辑草稿在组合 Enter/Escape/229 后仍保留。 |
| R12-05 / P2 | [session.ts](../../src/server/auth/session.ts) 的 GET/HEAD 使用同一生产读取额度。附件 content HEAD 显式 405，避免打开对象流。 | 真实 PostgreSQL 已耗尽桶拒绝 GET/HEAD；生产配置集成测试使用真实认证、Secure/HttpOnly Cookie、有效用户，HEAD 消耗最后额度后两者返回 429/Retry-After；匿名 401，缺失任务 404。真实浏览器 HTTP HEAD 无正文。 |
| R12-06 / P2 | [s3-lifecycle.json](../../infra/s3-lifecycle.json) 为非当前版本设置 30 天保留、清理过期删除标记与未完成 multipart；不设置当前附件到期删除。指南已加入控制台步骤。 | 独立本机 MinIO bucket 实际接受并读取规则；版本化上传、逻辑删除后按 VersionId 取回原内容。没有等待 30 天验证定时到期，没有修改真实 AWS bucket。 |
| R12-07 / P2 | [auth-cleanup.ts](../../tests/support/auth-cleanup.ts) 在事务中先查测试用户 ID，按 reset identifier 前缀 + value 精确删除，再删用户。auth-flow 使用 MAILPIT_API；集成 coordinator 新增两库指纹检查。 | 实际 SMTP 421 失败后生成未消费重置记录；清理后目标用户/令牌为零，无关记录仍在。全量集成 312 项通过，前后两库指纹一致。 |

Nginx 原始 error log 无法做字段脱敏，因此关闭该虚拟主机的原始错误输出；排障使用安全访问日志的状态/耗时和应用结构化错误。这是明确的诊断能力取舍，不是声称 Nginx 会自动脱敏原始错误。专用服务器默认虚拟主机也必须应用相同策略。

## 同步解决的审查改进项

- **长评论讨论**：[comment-list.tsx](../../src/features/tasks/comments/comment-list.tsx) 的“加载更多”只请求下一页；发布不再将页数设为 Infinity。用户尚未读到末尾时保留已加载窗口，提示新评论已发布到讨论末尾；已在末尾时显示新评论。95 条讨论的浏览器回归验证 30→60→90→96，加载下一页只产生一次带 cursor 的请求，发布不会把所有旧评论拉到页面。
- **日志**：[log.ts](../../src/server/http/log.ts) 消费 LOG_LEVEL。认证邮件与库事件、应用异常使用选定字段；Nginx 提供固定类别的路由/方法、状态、字节数和请求耗时。原始 URL、错误正文与 SMTP 回复不传入日志。级别过滤和既有错误脱敏测试通过。
- **维护积压**：[cleanup.ts](../../src/server/modules/maintenance/cleanup.ts) 每轮最多 10 个小批次，每表每批最多 1000 行；达到处理上限标记 saturated 并使维护命令返回非零。指南改为每小时 flock 防重叠运行。独立恢复数据库验证 1001 个到期桶分两批清理，未到期桶保留。
- **每日异地备份**：新增 [backup-database.sh](../../infra/backup-database.sh) 与 [备份 bucket 生命周期](../../infra/s3-backup-lifecycle.json)。脚本检查 dump 非空/目录可读、上传后核对长度、失败退出非零，成功异地复制后清理本脚本的旧本地备份。指南包含独立权限、AWS CLI profile、每日 cron、日志轮换和恢复核对步骤。独立 PostgreSQL 容器完成真实 pg_dump/pg_restore；云上传由本地替身隔离，失败上传正确返回非零。
- **文档**：更新 README 的迁移数量（14）、Mailpit 端口和当前状态；修正健康端点、OpenAPI 实现状态及个人展示部署形态；同步产品分页/IME/附件故障行为、API HEAD 说明、测试要求与环境文档。

## 本轮正式验证

本轮日志在 `artifacts/fixes-20260912/`，正式回归已加入 tests。总计 **806 项通过**，不包括额外基础设施与恢复探针：

| 命令/检查 | 最终结果 | 日志 |
|---|---|---|
| pnpm check | lint/typecheck、267 unit、137 contract 通过 | check-final.log |
| pnpm typecheck:scripts | 通过 | scripts-typecheck.log |
| pnpm test:integration | 26 文件、312 项通过 | integration.log |
| pnpm test:e2e --retries=0 | 77 项通过，含生产构建 | e2e.log |
| pnpm test:ui --retries=0 | 13 项通过，含生产构建 | ui.log |
| Nginx 真实配置/日志 | 通过 | nginx.log |
| S3 生命周期与历史版本 | 本地 MinIO 通过 | lifecycle.log |
| node --conditions=react-server --import tsx scripts/recovery-drill.ts | 隔离数据库/附件恢复与多批次维护通过 | recovery.log |
| 备份脚本实际 dump/恢复与失败上传 | 通过；云上传为本地替身 | backup.log |
| 最终两库指纹 | 与审查前一致 | fingerprint-final.log |

集成/E2E/UI 通过进程环境使用本次临时 Mailpit：SMTP_HOST=127.0.0.1、SMTP_PORT=25026、MAILPIT_API=http://localhost:28025/api/v1；**没有再使用测试源文件转换**。原 8025 被 Windows 保留，未修改系统保留区或覆盖本地 .env。临时 Mailpit/Nginx/备份 PostgreSQL 容器及其本次测试资源已清理。

执行中先纠正了一个新增日志配置的类型检查错误；SMTP 故障回归最初误以为认证 API 会抛错，实际 Better Auth 为防账户枚举返回相同成功信封，已按真实语义改为验证 SMTP 确实拒绝连接、重置记录存在以及 teardown 正确清理。上述最终完整套件均通过，没有删除或关闭失败断言来掩盖业务缺陷。

最终开发库 **712 行**、测试库 **72 行**，归一化全表内容指纹与审查前完全一致。没有新增数据库迁移。没有依赖变更；此前同日依赖扫描计数全为零，本轮不重复声称运行了新依赖扫描。

## 部署后仍须实际验收

1. 按[已更新 AWS micro 指南](../AWS-MICRO-DEPLOYMENT.md)应用日志、SMTP、S3 生命周期与备份配置；旧版已复制的配置需要同步更新。
2. 在真实 HTTPS 地址完成双账户流程、S3/SES 联调，并检查无敏感日志。生产配置集成测试使用真实认证处理器，不能替代网络 TLS、证书和云端权限验证。
3. t3.micro 1 GiB 的实际内存、swap、OOM 与体验仍待上机观察；必要时升级 small。本机测试环境为 Windows/Node 26.8.1，不等于 EC2 或 Node 24 CI。
4. 确认次日异地备份、失败/备份陈旧通知，并实际测量生产恢复窗口和耗时。此次本地恢复约 0.323 秒、完整演练约 6.63 秒，仅为合成小数据结果，不能证明生产 RPO≤24h/RTO≤2h。
5. 本轮没有触发远端 CI；历史 CI 结果不覆盖这些新修改。应用上线验收完成前 M6 不标 done。

官方行为依据：[Nginx 日志模块](https://nginx.org/en/docs/http/ngx_http_log_module.html)、[Nodemailer SMTP/TLS](https://nodemailer.com/smtp)、[AWS 生命周期到期规则](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html)。Next 路由/headers 和 Better Auth logger 依据本仓库锁定版本的随包文档与类型实现。
