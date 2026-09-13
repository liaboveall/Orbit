# Orbit 全项目深入审查 · 2026-09-12

> 本报告为历史问题基线：R12-01–R12-07 已由 [2026-09-12 修复验收](REVIEW-FIXES-2026-09-12.md)关闭。以下内容保留审查当时的发现与证据。

## 结论

本轮确认 **7 项待处理问题：1 项 P1、6 项 P2**。其中 4 项通过专项代码/浏览器探针复现，1 项在真实测试失败后发现，2 项由部署配置与官方行为核对确认。未发现新的已复现跨项目越权、重复写入或数据库配额竞争问题，但这不构成不存在漏洞的保证。

本轮为审查，未修改业务代码、认证设置或生产资源。诊断用例的通过表示成功复现缺陷，不表示已修复。既有 M6 生产部署、micro 容量和恢复目标仍未验收。

审查基线：分支 `codex/m6-release`，HEAD `16ec09faab8d97faf0306065bf8f7f040c817694`，包含本地尚未提交的 AWS micro 指南与交接文档。范围覆盖 M0–M6，M7 未实现且未纳入本轮功能验收。

## 问题清单

### R12-01 · P1 · Nginx 默认日志保存认证令牌

位置：`docs/AWS-MICRO-DEPLOYMENT.md` 第 12 节 Nginx server 配置；`infra/nginx.conf`；`src/server/auth/email.ts` 的 buildResetLink/buildVerifyLink。

部署指南只设置反向代理，没有覆盖访问日志格式。Nginx 默认 combined 记录 `$request` 和 `$http_referer`；前者包含完整查询串。项目的重置密码链接是 `/auth/reset-password?token=...`，验证邮件也使用带 token 的 URL。因此按当前指南部署后，点击邮件链接会将可用令牌写入访问日志，同源资源请求的 Referer 还可能重复携带它。取得这些日志的人，在令牌有效期内可能重置对应账户密码。

证据：应用实际链接构造和 Nginx 默认格式，依据 [Nginx 日志模块官方文档](https://nginx.org/en/docs/http/ngx_http_log_module.html)。没有访问用户真实云日志，也没有声称已发生泄露。

建议：上线前配置脱敏日志，不记录原始 request、query 或 Referer；认证路由须规范化为固定路由标签，因为认证库还支持带令牌的路径形式，单纯用 `$uri` 替换 `$request_uri` 不足以覆盖全部入口。同步检查敏感路径的 Nginx error log、代理/监控平台与认证页 referrer 策略。用合成令牌分别验证成功、失败和静态资源请求日志。

这是前一版 AWS 指南的遗漏，应先修正指南和部署配置，再完成公网验收。创建 EC2、准备域名与 S3 可以继续。

### R12-02 · P2 · 生产 SMTP 未强制 STARTTLS

位置：`src/server/auth/email.ts:54`，`createTransport` 仅传 secure 和 auth。

指南采用 587 / `SMTP_SECURE=false`。正常 SES 会提供 STARTTLS，通常会加密；但当前代码没有设置 `requireTLS`，不提供 STARTTLS 的服务端仍可诱使客户端发送 SMTP AUTH 和邮件。风险成立需要连接被错误指向或遭遇主动降级，不能把正常 SES 发信描述为明文。

复现：专项测试调用真实 `createEmailSender`，生产模式、合成凭证、仅监听本机的 SMTP 服务不声明 STARTTLS，却观察到 AUTH 并成功收信。没有发送真实邮件或使用真实凭证。证据：`artifacts/review-20260912/server-probes.test.ts` / `server-probes.log`。

建议：staging/production 使用隐式 TLS，或在 secure=false 时强制 requireTLS；本地 Mailpit 保留明文例外。加入“不支持 TLS 必须失败且不得发送 AUTH”的回归。依据 [Nodemailer SMTP TLS 参数](https://nodemailer.com/smtp)。

### R12-03 · P2 · 附件后台读取失败会丢失文件选择并中止上传

位置：`src/features/tasks/attachments/attachment-list.tsx:136`、`:172`；`src/features/tasks/attachments/upload-button.tsx:54`。

当附件 GET 刷新失败，容器整体改为错误分支，原列表与 UploadButton 被卸载。文件选择只存在上传组件 state 中，卸载后丢失；如果正在上传，卸载清理还会触发 AbortController。一次独立的列表读取失败不应取消用户的文件操作。

复现：真实认证进入任务详情，选择合成 `review-draft.txt`，对附件 GET 注入 503，再触发窗口 focus；文件名和文件输入都从页面消失。浏览器探针通过断言确认这一错误行为。证据：`browser-probes.spec.ts` / `browser-probes.log`。

建议：区分首次加载失败和后台刷新失败。已有数据/上传状态保留，错误提示作为附加区域；只有明确失权或父资源不可访问才卸载。回归覆盖已选未上传文件、正在上传、失败后重试三种状态。

### R12-04 · P2 · 中文输入法选词可能触发子任务提交

位置：`src/features/tasks/subtasks/subtask-list.tsx:217`、`subtask-item.tsx:244`；评论编辑的 Escape 处理也应一并核查。

新增和编辑子任务直接将 Enter 视为提交，没有判断 `nativeEvent.isComposing`。用户输入中文、按 Enter 确认候选词时，页面可能提前创建/保存半成品。Escape 也可能在取消候选词时清空草稿。

复现：在真实浏览器中新子任务输入框填写内容，发送 `isComposing=true` 的 Enter keydown；服务端实际收到 POST 并返回 201。此证据验证组合输入事件处理逻辑，未进行 Windows 原生输入法人工逐键测试。

建议：组合输入期间跳过 Enter/Escape 快捷操作，并考虑目标浏览器的 composition 兼容行为。保留普通 Enter 创建、Shift+Enter 换行的既有行为。

### R12-05 · P2 · HEAD 可绕过生产读取额度并触发数据库工作

位置：`src/server/auth/session.ts:42`；GET-only 的任务等 API 路由未单独定义 HEAD。

读取额度只判断 `source.method === "GET"`。Next 对 GET 路由自动提供 HEAD，调用原读取处理器但不返回正文；因此同一用户 GET 已达 300 次额度后，HEAD 仍能通过会话层并执行数据库读取。此问题影响资源保护，不会绕过项目成员授权或直接返回私有正文。

两段证据：浏览器 HTTP 探针对真实认证任务路由执行 HEAD，返回 200；服务端探针在真实 PostgreSQL 中放入已用尽的 read bucket，同一合成身份 GET 抛 RATE_LIMITED，HEAD 返回用户。服务端探针仅替换会话读取，以隔离限流逻辑，不声称它是完整生产 HTTP 部署测试。

建议：HEAD 与 GET 使用相同读取准入，或显式拒绝不支持的 HEAD；结合下载路由避免 HEAD 不必要地打开存储流。补生产模式额度耗尽时 GET/HEAD 一致的回归。

### R12-06 · P2 · S3 开启版本后未设置历史版本保留期限

位置：`docs/AWS-MICRO-DEPLOYMENT.md:115`；`src/server/modules/storage/client.ts:49`。

指南开启 Versioning，但没有配置 noncurrent version 生命周期。应用清理调用不含 VersionId 的 DeleteObject，在开启版本的 bucket 中只创建删除标记，原对象变为历史版本并继续收费；数据库则已释放其逻辑配额并清除 cleanupPending。反复上传/删除后，应用显示的有效附件空间并不代表 S3 的实际计费空间。

证据：代码调用参数与 [AWS 版本对象删除规则](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeletingObjectVersions.html)。未在用户 AWS bucket 执行测试。逻辑配额统计有效数据本身没有错误，缺陷是部署指南未落实历史版本保留策略。

建议：保留版本恢复能力，同时为非当前版本制定明确保留天数，并清理过期删除标记；不要给当前 READY 文件设置无条件到期删除。期限应与数据库备份恢复窗口一致，并观察实际存储用量。

### R12-07 · P2 · 认证集成测试失败路径遗留重置记录

位置：`tests/integration/auth-flow.test.ts:149`，其他按 identifier 包含 RUN_TAG 清理的认证测试也应复核。

afterAll 删除测试用户后，按 `identifier contains RUN_TAG` 清理 Verification。但密码重置记录的 identifier 是 `reset-password:<随机 token>`，value 才是测试用户 ID。失败发生在令牌消费之前时，这种清理条件无法命中，也没有外键帮助删除。

真实证据：首轮 SMTP 连接失败后，开发库指纹不变，测试库从 72 行变为 74 行；新增的两行均是本次运行时间内的密码重置记录，关联测试用户已被清理。已按事先记录的两个精确 ID 清理，恢复到原始两库指纹，没有删除旧记录。

建议：在删除用户之前记录测试用户 ID，按 Verification.value 和已捕获的 token 标识精确清理；为集成套件增加与 E2E 相同的前后指纹验证。对“SMTP 失败后 teardown”增加回归，不能用清空测试库掩盖问题。

## 覆盖范围与尚未关闭的风险

本轮检查了认证工厂和会话、Origin/代理信任边界、全部业务路由的授权接入、项目/任务/成员/邀请事务、幂等与版本冲突、分页与看板快照、评论/子任务、附件预留/流式接收/补偿/下载签名、工作台时区、Markdown 渲染、前端草稿与刷新、数据库迁移约束、共享限流、CI、容器和部署指南。

以下是已知限制或改进项，不重复计入上述 7 项：

- **micro 容量**：本轮测试机器是 Windows / Node 26.8.1，本地生产构建浏览器服务；没有 1 GiB EC2 实测，也没有证明 swap 后稳定。历史远端 Node 24 CI 不替代本轮 AWS 验收。
- **生产模式覆盖**：主集成/E2E 使用 APP_ENV=test。现有 M6 双数据库池测试验证共享限流原子性，但不能代替 HTTPS + APP_ENV=production 的完整部署检查。
- **备份与恢复**：micro 指南只配置手动数据库备份，自动每日异地备份、生产恢复演练、告警仍待完成。没有新执行恢复演练，不沿用历史结果冒充本轮实测。
- **可观测性**：架构文档已承认 LOG_LEVEL 尚未消费，完整请求时长/状态结构化日志未落实。维护任务每表最多清理 1000 行/次，增长超过调度吞吐时需观察积压并调整。
- **评论加载成本**：发布一条评论会把 pages.current 设为 Infinity，从头读取全部评论；首次“加载更多”也重读旧页。小数据可用，但满额长讨论在 micro 上需要测量并优化刷新策略。
- **文档漂移**：README 仍写 11 个迁移，实际为 14；架构某段仍说健康端点未实现；不同历史交接段落保留旧状态。应以本轮报告、PROGRESS 顶部与 backlog 为准，再统一更新过时陈述。
- **本地端口**：本机 Windows 将 7971–8070 划入保留区，包含 Mailpit 8025。Compose 支持 MAILPIT_WEB_HOST_PORT，auth-flow 集成测试却写死 8025；需要统一端口配置。当前用临时端口适配继续验证，未改本机系统保留区。

## 本轮验证与证据

所有本轮原始日志、专项探针和指纹位于 `artifacts/review-20260912/`（本地诊断目录，未加入正式回归套件）。

| 检查 | 实际结果 | 证据 |
|---|---|---|
| pnpm lint | 通过 | lint.log |
| pnpm check | lint/typecheck、266 unit、137 contract 通过 | check.log |
| pnpm typecheck:scripts | 通过 | scripts-typecheck.log |
| pnpm audit --json | 已知漏洞计数全为 0；仅代表本次扫描结果 | audit.json |
| 首轮 pnpm test:integration | 301 通过，7 失败，原因是本机 SMTP/邮件 API 不可达 | integration.log |
| auth-flow 临时端口复验 | 22 通过；只替换测试 Mailpit API 地址与 SMTP 环境变量 | auth-flow-port-override.log |
| 全量集成临时端口复验 | 24 个文件、308 项通过，59.82 秒 | integration-port-override.log |
| 生产构建 + 全量 E2E | 70 通过，retries=0 | e2e.log |
| UI | 13 通过，retries=0 | ui.log |
| 浏览器诊断 | 3 通过：复现 IME 提交、附件文件丢失、HEAD 调用 GET | browser-probes.log |
| 服务端诊断 | 2 通过：复现 HEAD 限流遗漏、SMTP 不强制 TLS | server-probes.log |
| 规划检查 | PASS；报告与 backlog 交接后复验 | plan-final.log |

复验的环境适配：新建本次专用 Mailpit 容器 `orbit-review-mailpit-20260912`，仅绑定本机 25026/28025；未重建或清空原有数据库/MinIO。SMTP_HOST=127.0.0.1、SMTP_PORT=25026、MAILPIT_API=http://localhost:28025/api/v1。`mail-port.config.ts` 仅将 auth-flow 测试中硬编码的 8025 替换为 28025，没有更改断言、认证业务代码或数据库目标。

数据保护：起始开发库 712 行、测试库 72 行。首轮失败引入两条已确认的测试残留，精确移除后恢复原指纹；随后浏览器与服务端诊断、E2E、UI 均完成隔离检查。最终全量集成复验结果与最终指纹见本报告末尾交接记录。

## 修复顺序

1. 公网上线前处理 R12-01 日志与 R12-02 SMTP 传输要求，同时补齐 R12-06 S3 历史版本策略。
2. 修 R12-03/R12-04，分别增加刷新故障和 IME 回归；修 R12-05 的 GET/HEAD 准入。
3. 修 R12-07 及本地邮件端口配置，验证失败路径也能恢复两库指纹。
4. 完成 micro 上真实 HTTPS 双账户操作和内存观察，再判断是否需要 small。

M1 的邮件任务、M5 的子任务/附件任务回到 review；M6 保持 review。其余已验收范围不因本轮没有新发现而被重新宣称绝对安全，也不因这些局部缺陷全部退回未实现。

## 最终交接记录

全量集成复验命令为 `pnpm exec vitest run --config artifacts/review-20260912/mail-port.config.ts --project integration`，并使用上述 SMTP/MAILPIT_API 环境变量；结果 24 个文件、308 项通过。它不是未经适配的默认命令通过记录。

本次临时 Mailpit 容器已移除，原数据库和 MinIO 保留。最终 `fingerprint-final.log` 与起始指纹完全一致：开发库 712 行，测试库 72 行。集成测试失败路径本身仍需修复，不能将本次精确清理视为正式 teardown 已正确。

README、PROGRESS 与 backlog 已指向本报告；AWS 指南顶部加入待修事项提示。本轮只交付审查与状态记录，没有实施上述业务修复，也没有提交、推送或部署。
