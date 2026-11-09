# Orbit 全项目审查与修复 · 2026-11-09

## 当前修复与验收结果

**R1—R7 全部已在本地修复并通过完整冻结验收。** 980 项测试通过：304 unit、172 contract、381 integration、110 E2E、13 UI，浏览器零重试、开发/测试库前后内容指纹一致。门禁源码摘要 `76410f0592964a32c929ab7aebe0595581f88df2c27adae023a9514e3c319b1e`，运行前后相同；之后只更新交接文档。新真实备份检查同样通过。这批修复已随 `e199be4` 提交，`237c4f3` 完整 CI 通过并已部署，见 [当前状态](CURRENT-STATUS.md)。

| 已关闭问题 | 实现和验收证据 |
| --- | --- |
| R1 BACKUP-PAIR | 内部 flock；两文件通过校验才发布共同摘要清单；select-backup 选择同一完整批次；失败/同长度损坏不被当成完成备份 |
| R2 BACKUP-SNAPSHOT | 在数据库快照之前停止存储，保持冻结至归档结束；真实独立 PostgreSQL/SeaweedFS 演练中快照 READY、后续记录 DELETED，物理删除被阻止，真实成对恢复文件逐字节一致 |
| R3 DRAFT-SAVE404 | 保存 404 保留只读文本及本地副本，不自动关闭侧栏；标题/描述 × 独立页/侧栏共 4 个真实浏览器回归通过 |
| R4 SUBRESOURCE-DRAFTS | 远端删除时保留正在编辑的行；父任务删除/归档保留只读草稿；子任务删除、两种子资源父任务删除、评论归档回归通过 |
| R5 READINESS-SCHEMA | 构建时生成迁移/列元数据；检查成功迁移/checksum 和必需列类型/可空性；真实一次性库中的空库、仅限流表、失败迁移、缺业务列均拒绝 |
| R6 WINDOWS-MIGRATION | Windows 开发/测试非 TLS localhost 规范化为 IPv4，模板直接使用 IPv4；默认恢复命令无需外部覆盖即通过，生产/staging 和显式 sslmode 不改写 |
| R7 DEV-DEPENDENCY | 精确覆盖 minimatch 10.2.6 为 11.0.1；lint 与完整门禁通过，全依赖审计 0；未重新启用 Dependabot 自动版本更新 |

新增正式回归：`tests/e2e/review-boundary-regressions.spec.ts`（8 项）、`tests/integration/readiness-schema.test.ts`（1 项），以及已接入门禁和 CI 的 `scripts/verify-local-backup.mjs`。故障注入脚本 `scripts/verify-backup.sh` 也通过；所有临时数据库、容器和卷按本次所有权清理。

**运行代价和剩余边界**：附件服务在整个数据库 dump/归档期间暂时不可用，web 其他功能继续运行；备份时长应计入生产运维预算。旧备份不自动伪造完成清单。readiness 检查迁移与列，不替代独立约束/索引审计。真实 SMTP 未提供，未做线上双账户、负载或异地恢复；原有 7 组外部/历史事项继续开放。上游最新仍是 better-auth 1.7.18 / utils 0.5.1，保持上游跟踪，不自行替换密码哈希。

证据：`artifacts/remediation-20261109/` 与 verification 的 `comprehensiveRemediation20261109`。此前备份测试开发中两次因容器重启后随机宿主端口变化而失败；修正测试重新读取端口后，定向及冻结门禁均通过。未将失败尝试计为成功。

下面保留修复前审查、复现和历史边界，具体问题是否开放以上面修复表和 open-items 为准。

## 修复前结论与受测版本

**仍有问题。当前已有完整的 V1 核心实现和较强的自动化验证，但尚未达到 V1 发布验收完成。** 本轮确认 7 组新增待处理事项：6 组 P2、1 组 P3；另纠正文档中的过期或冲突描述。原有 7 组外部/历史事项继续保留，合计 14 组开放事项。本轮没有确认 P0/P1，也没有取得远程越权、账户接管或生产数据已损坏的证据；这不构成不存在这些问题的证明。

受测提交：`4c88b1a757543ee1a529b79dee78bfce11ca07f9`，审查开始时工作区干净。完整门禁于 2026-11-09 08:16:59—08:26:00（Asia/Singapore）运行，源码摘要 `7bb8f2cc668e4d035f957129720f908b466d43cba002b33ac8af5c37fe6ac12a`，运行前后相同。之后仅增加审计产物、更新文档与规划记录；**未修改应用、迁移、依赖、基础设施脚本或既有测试，未提交、推送或部署**。

P2 表示应在对应发布、恢复或协作验收前修复的确定问题；P3 为较低优先级维护项。审查范围是当前 V1（M0—M6）；M7/AI 尚未实施属于既定范围，不列为缺陷。状态映射见 [开放清单](../planning/open-items.json)、[backlog](../planning/backlog.json) 和 [verification](../planning/verification.json)。旧审查正文由 Git 历史与 verification 中的既有记录保留。

## 方法与实际验证

先核对 README、PROGRESS、执行总览和 backlog，再对照产品、设计、数据、API、测试、部署规格。重点检查会话、成员/资源归属与写权限、事务和锁顺序、版本/移动/恢复、邀请/成员移除、附件状态与补偿、草稿/刷新、缓存/限流、CI、镜像和恢复路径。

本机 Windows、Node 26.12.1、pnpm 10.34.5；CI 为 Linux/Node 24，部署目标为 OCI ARM64。启动既有 Docker Desktop，使用本机 PostgreSQL、SeaweedFS 和 Mailpit。既有测试使用独立测试库和精确夹具清理；额外系统实验新建随机命名的一次性数据库和 bucket，结束后删除。未清空开发/测试/正式库，未输出或提交环境秘密。公网检查只有未登录 GET，没有线上写入、压测或 SSH 操作。

| 实际检查 | 结果 | 证据边界 |
| --- | --- | --- |
| `node scripts/verify-remediation.mjs` | PASS，源码未变化 | 输出 `artifacts/full-review-20261109/gate` |
| lint、typecheck、typecheck:scripts、planning/probes/status、image-policy | 全部退出 0 | 静态检查与治理规则 |
| unit / contract / integration / E2E / UI | **304 / 172 / 380 / 102 / 13，共 971 项通过** | 浏览器零重试；E2E 包含实际生产构建 |
| 集成与浏览器隔离 | 开发/测试库前后内容指纹相同 | 本轮运行无遗留夹具或原有记录改动 |
| bundle 检查 | 14 路由，真实路由样例模块泄漏 0 | 当前检查器覆盖范围 |
| `pnpm audit --prod --audit-level=high --json` | 退出 0，各严重等级均 0 | 此时生产 npm 依赖公告数据库 |
| `pnpm audit --json` | 全依赖 1 项 moderate | ESLint 工具链，见 R7 |
| `node scripts/verify-migration-history.mjs` | 两库各 16/16，缺失/checksum 不符均 0，schema 摘要一致 | 当前新建开发/测试库，不解决已丢失旧卷的取证 |
| `node scripts/verify-compose.mjs` | 两种生产编排解析、私有端口、日志轮转通过 | 配置检查，不是部署容量验收 |
| `node scripts/verify-nginx.mjs` | 60 请求：11 接受、49 次 429；敏感标记不入日志，503 可观测 | 隔离容器中的固定镜像和配置 |
| 默认 `scripts/recovery-drill.ts` | 退出 1，prepare 阶段失败 | 当前 Windows，见 R6，不记为通过 |
| 同一恢复脚本，仅把测试连接 hostname 改为 `127.0.0.1` | 退出 0；成员、任务版本、评论、活动、附件 SHA-256 均核对通过 | 合成数据恢复阶段约 0.327 秒，不是生产 RTO |
| 额外浏览器诊断 | 4 项缺陷观察复现；清理后两库指纹不变 | 断言缺陷现状，**不计入 971 项验收通过数** |
| 额外系统诊断 | ready 假阳性、快照/文件删除窗口、失败备份错配复现 | 各实验限制见 R1/R2/R5 |

当前 SHA 的 [GitHub Actions 42502294829](https://github.com/liaboveall/Orbit/actions/runs/42502294829) 完整成功。已下载 `quality-evidence` 并核对性能、恢复及 runner/operations Trivy 报告。本轮没有重新构建 ARM64 镜像，也没有重新核对生产主机运行镜像；既有上线记录绑定 `72ff749`，不能将当前 HEAD 的 CI 自动视作线上同版本验收。

## 新增问题与验收要求

### R1 · P2 · 附件归档失败后留下可被误选的数据库备份

开放 ID：`BACKUP-PAIR`。位置：[backup-local.sh](../infra/backup-local.sh) 27—41 行，以及 [OCI 部署指南](OCI-DEPLOYMENT.md) 的下载/恢复章节。

脚本校验数据库 dump 后立即将 `.dump.partial` 改名为 `.dump`，随后才打包附件。若 tar 失败，清理只移除 `.partial`；新的 dump 和旧的附件包同时存在。受测文档分别用 `ls -t ... | head -1` 选择两者，可能把失败批次的新数据库与上次成功的旧附件拼成一个恢复集。

**复现**：断网一次性 Debian 容器中运行真实备份脚本，Docker 子进程替身注入第二次归档失败。第一次成功、第二次返回非零；按受测文档选择，dump 来自第二批 `20261109T020000Z`，附件来自第一批 `20261109T010000Z`，不含第二批文件。实验验证真实脚本控制流与选择规则，dump 内容为合成占位，并非一次真实数据库恢复。

影响：脚本虽然报错，目录里的“完成文件”却不足以识别完整恢复集。既有 `verify-backup.sh` 在失败后断言两个 dump、一个附件包，没有验证恢复配对，因而仍通过。

修复：为一个批次建立 manifest/目录，记录共同 ID、两类文件及摘要；二者都成功后才发布完成标记。下载与恢复只使用该标记指定的配对，失败批次不得被当作完整备份。文档已标注限制，脚本未修复。

验收：一次成功后再注入归档失败，恢复选择器仍选上次完整批次；验证配对 ID/摘要、中止清理、重试和半成品不可见。

### R2 · P2 · 数据库快照与附件物理清理之间没有一致性屏障

开放 ID：`BACKUP-SNAPSHOT`。位置：[backup-local.sh](../infra/backup-local.sh) 25—36 行、[attachments/cleanup.ts](../src/server/modules/attachments/cleanup.ts) 10—23、64—77 行，以及 OCI 指南两条互不互斥的 flock 定时任务。

“先数据库、后附件”只保证快照里的 READY 对象曾写入过。dump 期间 web 继续运行，用户可删除附件，维护程序等待 3 分钟后物理删除。备份锁 `orbit-backup.lock` 与维护锁 `orbit-maintenance.lock` 不共享；长备份或手工并发执行时，快照仍引用 READY，对象却可能在归档前被删除。

**复现**：一次性真实 PostgreSQL/SeaweedFS 中，通过真实业务服务建立 24 字节 READY 附件；持有 REPEATABLE READ 快照；另一连接调用真实删除服务，再把既有可注入维护时钟推进 181 秒，执行真实清理。快照前后均为 `READY, sizeBytes=24`，S3 HEAD 为 404，`cleanedCount=1`。

这是模拟 pg_dump 一致性快照与清理交错的受控实验：没有等待真实 3 分钟，没有执行整次生产 pg_dump/tar，没有证明线上备份已经损坏。默认备份 03:10、维护每小时 :20，短备份通常不会重叠；触发条件是窗口足够长或任务主动重叠。

修复：从快照开始到附件归档结束协调所有物理删除入口，或采用经过恢复验证的对象版本/保留机制。只错开 cron 不足以处理手工执行、重试或备份延长。

验收：在真实备份中并发删除附件并执行维护，再恢复到隔离库/存储，逐个核对快照中全部 READY 引用、字节数与摘要；覆盖长备份、中止、锁释放和失败恢复。

### R3 · P2 · 保存收到 404 时直接删除任务文本草稿

开放 ID：`DRAFT-SAVE404`。位置：[task-editor.tsx](../src/features/tasks/real/task-editor.tsx) 164—171、188—191 行，[task-panel.tsx](../src/features/tasks/real/task-panel.tsx) 的 `onDeleted={close}`。

用户编辑描述，另一端删除任务，原页面点击保存。PATCH 404 后调用 `discard()`，清空 React draft 和 localStorage；侧栏还立即关闭。独立详情页虽然提示“未保存的内容仍显示在下方”，草稿实际上已被清除。

**真实浏览器与 API 复现**：独立详情和看板侧栏均返回 PATCH 404；编辑器数量变为 0，本地草稿 key 变为 null，侧栏 URL 的 task 参数消失。账户、任务、删除均为本机合成夹具，没有 mock API 响应。

违反 [产品规格](01-PRODUCT-SPEC.md) §7 的删除后保留最后内容与草稿、只读供复制要求。既有 E2E 覆盖后台刷新发现删除后的评论草稿，没有覆盖编辑中保存收到 404 的分支。

修复：进入不可保存的只读状态并保留可复制文本，不能复用成功删除或用户确认放弃的关闭路径。要区分任务删除和真正失去项目权限，后者仍遵守敏感草稿清理规则。

验收：标题/描述、独立页/侧栏均覆盖；404 后文本可见可复制，未获确认不关闭；主动放弃、登出和成员资格丢失规则仍正确。

### R4 · P2 · 子资源刷新和权限变化未完整保留草稿

开放 ID：`SUBRESOURCE-DRAFTS`。同一产品约束下确认了两个分支，影响不同：

1. **子任务编辑丢失**：[subtask-list.tsx](../src/features/tasks/subtasks/subtask-list.tsx) 67—96 行刷新后替换列表；[subtask-item.tsx](../src/features/tasks/subtasks/subtask-item.tsx) 54—59 行将草稿仅放在行组件 state。另一端删除子任务，focus 刷新直接卸载该行，编辑文本消失，无确认弹窗。真实 DELETE 204 与浏览器 focus 已复现。导航保护不能拦住列表刷新卸载组件。
2. **归档后新评论草稿不可见**：[comment-list.tsx](../src/features/tasks/comments/comment-list.tsx) 295—341 行通过 canWrite 控制整个输入区。输入后另一端归档，刷新使输入区消失；解除归档后原文重新出现，证明仍在 state 中。因此确认的是暂时无法读取/复制，不是归档瞬间永久删除。普通成员不能自行解除归档。

服务端拒绝已删除/归档资源写入是正确的，问题在前端生命周期。修复应将草稿与远端列表行解绑或保留只读占位，失去写权限后提供复制入口，不恢复服务端写权限。

验收：行删除、父任务删除、归档、聚焦刷新、取消与确认离开；分别覆盖编辑子任务、编辑评论、新评论，不能仅用任务标题/描述用例代替。

### R5 · P2 · ready 探针不能证明迁移兼容

开放 ID：`READINESS-SCHEMA`。位置：[readiness.ts](../src/server/modules/maintenance/readiness.ts) 7 行，仅执行 `SELECT 1 FROM "RateLimitBucket" LIMIT 1`。

**复现**：一次性数据库只创建 `RateLimitBucket(dummy integer)`，没有 User/Project/Task，也没有迁移历史；调用真实 `/health/ready` handler，得到 200 和 `{"status":"ready"}`。因此部分迁移、不兼容或错误恢复库可能被放行。

影响是发布/故障检测假阳性，不代表当前生产缺表。当前本机两库 16 条迁移完整；线上 ready 200 也不足以判定存在或不存在该故障。架构承诺数据库连接和迁移兼容，实际只检查一张表能否访问。

修复：明确应用 schema 兼容标记或必要结构检查，并在发布阶段校验迁移历史；避免每次健康请求做昂贵全库审计，不把可选邮件/存储短暂故障扩大为整个应用不可用。

验收：空库、仅限流表、缺关键迁移/失败迁移/不兼容结构返回 503，兼容完整库返回 200；响应不泄露内部结构或错误。

### R6 · P2 · 当前 Windows localhost 连接使迁移和恢复 CLI 失败

开放 ID：`WINDOWS-MIGRATION`。位置：[.env.example](../.env.example) 4、9 行，[compose.dev.yml](../infra/compose.dev.yml) 19 行，[prisma.config.ts](../prisma.config.ts) 和 [recovery-drill.ts](../scripts/recovery-drill.ts) 的迁移子进程。

模板使用 localhost，Docker 仅绑定 IPv4。当前 Windows/Node 26.12.1 环境，Prisma 7.10 `migrate status` 指向正在正常使用的同一 orbit_test：localhost 退出 1（Schema engine error），只换成 127.0.0.1 后退出 0，16 条迁移均已应用。一次性新库 migrate deploy 也有相同差异。应用运行时的 ipv4first 不保证独立 Prisma schema engine 采用同样地址选择。

默认恢复脚本退出 1，prepare 阶段失败；仅覆盖 TEST_DATABASE_URL 的 hostname 后同一脚本完整通过。一切临时库均已清理，未修改 .env.local。本机宿主端口 5433、模板 5432；对照保持端口和其余参数完全相同。

这是本机可移植性问题，不能推断 Linux CI 或生产内部 postgres 主机名也失败。底层具体地址选择原因未进一步抓包确认。

修复：统一 Windows 本地 PostgreSQL IPv4 endpoint 约定及 CLI/脚本配置，保持生产主机名、TLS、凭证不变；补空库官方迁移命令冒烟。无需替换 Prisma 大版本或降低连接安全。

验收：文档配置下本机 migrate status/deploy 和隔离恢复成功，Linux CI 仍通过，失败日志无密码。

### R7 · P3 · ESLint 传递依赖新增 minimatch 中危公告

开放 ID：`DEV-DEPENDENCY`。全依赖审计路径：eslint-config-next → eslint-plugin-import → @typescript-eslint/parser → @typescript-eslint/typescript-estree → minimatch 10.2.6。生产依赖审计仍为 0。

[上游 GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249) 描述特定优化等级和受控 glob 输入可能导致过量 CPU/内存开销，公告修复版本为 11.0.1。没有证明当前 lint 配置或公网业务可触发，不能写成已证实线上拒绝服务。

处理：跟踪 ESLint/Next 工具链兼容更新，必要时评估经过回归的精确 override；不为清零而无验证强制跨主版本。验收为公告不再命中且相关 lint/typecheck/contract 检查通过。用户已关闭 Dependabot 自动版本更新，本轮不改变该决定，后续仍需人工复查。

## 文档一致性问题（本轮纠正文案）

这些会误导后续实现和验收，不另计为开放应用缺陷：执行总览仍把 EC2/S3/SES 写成当前目标；环境文档称 SeaweedFS 仅用于本地/CI；数据保留段落声称用户可永久删除任务；架构 Forms 声称使用未安装的 React Hook Form；状态/手册仍把旧卷 checksum 异常写成当前库事实。已分别按 ADR-030、产品规格、实际依赖和本轮只读迁移结果纠正。

readiness 文案明确标注实现不足，保留兼容性验收要求；备份说明标注 R1/R2，不再把静态成功恢复当作所有时序都正确。产品行为和代码没有借此次文档修订改变。

## 各层评估

| 领域 | 证据支持的结论 | 剩余重点 |
| --- | --- | --- |
| 产品/完成度 | M0—M5 核心闭环实现，M6 review；AI 留在 V1.1 | 真实双账户从验证到协作/重置完整验收 |
| 架构/契约 | 分层、strict、运行时校验及 172 契约测试通过 | 维护现有边界，无需重搭或引入微服务 |
| 认证/授权/隐私 | 已检查会话、成员/资源归属、写权限、附件代理；现有越权/归档/缓存测试通过 | 未做独立渗透测试；真实邮件与部署代理边界需现场验收 |
| 数据/并发 | 项目锁、版本、幂等、配额、回滚等 380 集成用例通过，两库一致 | 业务事务正确不等于数据库和附件备份跨系统一致，见 R1/R2 |
| 协作/UI | 主流程、键盘替代、错误/权限/移动视图有自动化 | R3/R4，真实输入法、200% 原生缩放、辅助技术 |
| 附件 | 真实校验、配额、补偿、私有下载与隔离恢复有证据 | 并发备份/清理、主机故障和异地恢复 |
| 性能 | 本机/CI 限定场景无错误 | OCI 共用主机混合负载、长时运行、连接池/磁盘预算 |
| 部署/运行 | 当前 SHA CI、扫描策略、Nginx 检查通过，公开入口可读 | ready、正式镜像绑定、邮件、告警、异地备份、RPO/RTO |
| 安全维护 | 当前生产 npm 审计 0，已安装近期安全修复版本 | R7、既有密码比较实现、镜像残余风险 |

### 性能数据的边界

| 指标 | 本轮本机生产构建 | 当前 SHA 的 Linux CI |
| --- | --- | --- |
| 数据/并发 | 1000 tasks + 1000 subtasks + 1000 comments，10 并发 | 相同场景 |
| 读 p95，100 样本 | 47.48 ms | 168.83 ms |
| 写 p95，完整 40 样本 | 85.49 ms | 128.18 ms |
| 预算用写 p95 | 未排除批次 | 125.16 ms，排除最慢 10 请求批次后仅 30 样本 |
| 错误率 | 0 | 0 |
| 工作台实验就绪 p95，5 样本 | 810.53 ms | 1296.45 ms |
| 被测页面 axe serious | 无 | 无 |

工作台实验：1440px、CPU 4 倍减速、40ms 延迟、10Mbps 下行/5Mbps 上行、冷 HTTP cache，测到标题可见且导航可聚焦，不是 INP 或线上 Core Web Vitals。CI 排除最慢批次是已有明确记录的口径，完整样本也保留且本轮通过预算；筛过的数值不能叫完整线上 p95。没有据此推算支持多少真实用户。

### 依赖与镜像风险的边界

已核对 [Next 16.4.5 官方发布](https://github.com/vercel/next.js/releases/tag/v16.4.5) 和 [Better Auth 2026-11-03 安全发布](https://better-auth.com/blog/security-release-2026-11-03)，当前安装 16.4.5 / 1.7.18；不把旧版已修复公告继续算为当前缺陷。

当前 SHA 的 runner 和 operations Trivy 报告**各有 35 条包/漏洞组合记录（34 HIGH、1 CRITICAL）**，均未给出修复版本。同一 CVE 可涉及多个包，不能称为 35 个独立 CVE。[既定镜像策略](../planning/image-security-policy.json) 允许无补丁且未确认应用影响的条目保留，本轮重新执行策略检查通过。扫描命中不等于远程可利用，也不能写成镜像零漏洞。这是 CI 镜像扫描，未核验线上 ARM64 镜像相同。

UPSTREAM 复查：better-auth 1.7.18 转发到 @better-auth/utils 0.5.1，密码派生值仍使用 `hex.encode(targetKey) === key`。没有远程计时利用证明；维持上游跟踪，不自行替换哈希体系。

### 公网只读观察

本轮访问 `https://149-118-55-232.sslip.io`：首页、/demo、/auth/login 为 200；/health/ready 为 200 且 no-store；未登录 /app/today 为 307 跳登录；/api/v1/projects 为 401 且 private/no-store。

这些只证明检查时的公开入口和未登录拒绝行为。没有在本轮验证线上登录后数据、邮件、邀请、附件或恢复。既有 2026-11-09 单账户合成试用与附件恢复记录保留在 verification，但不能与本轮本机浏览器测试混写。

## 原有 7 组事项

| ID | 当前事实 | 仍需证据 |
| --- | --- | --- |
| RELEASE-CI | 当前 4c88b1a 完整 CI 成功，产物已读取 | 正式交付 SHA 与实际部署不可变 ARM64 镜像绑定 |
| UPSTREAM | 密码比较实现仍为字符串比较 | 上游修复/兼容更新及回归；未证实远程利用 |
| CAPACITY | 本机/CI 实验，不是 OCI 容量测试 | 共用主机混合附件流量、内存、连接池、限流写入、磁盘和 p95 |
| DEPLOYMENT | 既有第一阶段上线/单账户恢复，本轮仅公开只读检查 | 真实邮件验证/重置、双账户邀请协作、告警、自动异地备份、生产 RPO/RTO；自有域名按既定路线 |
| MIGRATION-HISTORY | 当前两库 16 条迁移一致，旧不符卷已不存在 | 原始字节或有证据的历史事件关闭决定，不覆盖 checksum |
| DATA-RECOVERY | 原始记录/备份缺失 | 独立历史恢复依据，当前测试不能证明过去数据恢复 |
| NATIVE-DEVICE | 自动浏览器覆盖核心流程 | 实机输入法、原生缩放与辅助技术 |

认证邮件响应后投递，SIGKILL/OOM 可能丢失尚未发出的邮件，用户可重发；属于已记录运行边界。本轮不增加未经批准的队列基础设施，正式邮件接入后应验证失败提示、重发与重启情况。

## 下一步与交接

1. 在 M6 内先修 R1/R2：完整批次识别、备份与物理清理协调，加入失败/并发恢复回归。
2. 修 R3/R4：统一任务/子资源草稿生命周期，回归删除、归档、权限丢失与导航保护。
3. 修 R5/R6：schema 兼容就绪与 Windows 空库迁移/恢复冒烟。
4. 处理 R7 兼容更新；对最终冻结提交验收并绑定 CI/镜像。
5. 完成邮件/双账户、容量、告警、异地恢复和实机验收；M6 达标后再讨论 M7。

本轮只完成分析与记录，上述 7 组问题均未通过修改产品代码修复。PROGRESS/backlog/open-items/verification 已按此状态交接。

## 本地证据索引

产物根目录 `artifacts/full-review-20261109/` 被 Git 忽略；长期结论、命令、摘要和哈希存入本文件与 verification。

| 文件 | 内容 |
| --- | --- |
| gate/summary.json、gate/source-hashes.json、各 .log | 冻结门禁、源码身份、退出码 |
| browser/review.spec.ts、playwright.review.config.ts、browser.log、browser-report.json | 4 项诊断与实际结果 |
| save-404-standalone.png、save-404-panel.png、subtask-remote-delete.png、archive-hidden-comment.png | 合成账户浏览器截图 |
| system-probes.ts、system-observations.json | ready 与快照/清理时序实验 |
| backup-pair-probe.sh、backup-pair-observation.json | 实际备份脚本失败控制流/错配 |
| migration-host-probe.mjs、migration-host-observations.json | 同库 localhost/IPv4 对照 |
| recovery-default.log、run-recovery-ipv4.mjs、recovery-ipv4.log、recovery.json | 默认失败及仅换 hostname 后成功 |
| migration-history.log、nginx-summary.json、client-bundles.json | 迁移、代理和 bundle |
| audit-all.json、gate/audit.log | 全依赖与生产依赖审计 |
| performance-local.json、remote-ci/artifacts/release/ | 本机/当前 SHA CI 性能、恢复、扫描原件 |
| remote-ci-run.json、remote-ci-jobs.json、public-readonly.json | 远端 CI 身份及公网只读观察 |

额外诊断通过表示成功观察到缺陷。修复时应反转断言并加入正式回归，不能把诊断通过当作产品已满足要求。
