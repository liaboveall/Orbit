# 2026-09-13 — 验收返工完成与复验（当前最新状态）

**已确认的本地功能缺陷修复并通过871项测试；生产外部验收与历史误删证据仍未完成。** 最新依据：[返工交付报告](docs/reviews/REMEDIATION-REWORK-CLOSURE-2026-09-13.md)、[事件追溯](docs/reviews/TEST-DATA-INCIDENT-2026-09-13.md)。下方旧记录保留历史原貌。

- 修复认证超限500、SMTP总预算未断开连接、创建表单取消/收起丢草稿；完成真实服务端错误边界重试验证；下载补齐长度、取消、总预算、脱敏诊断与资源释放。
- 全量回归额外复现并修复评论“加载更多”被后台刷新取消的竞态；增加受控时序验证。清理助手增加本轮基线保护，在任何关联删除前拒绝历史用户。
- 最终lint、typecheck、scripts typecheck退出0；261 unit、161 contract、355 integration、81 E2E、13 UI共871通过，浏览器零重试。数据库套件串行，开发/测试两库内容指纹一致。prod扫描436依赖，已知漏洞0。
- 独立源码快照冻结锁文件离线安装和生产build、operations/runner镜像构建及合成凭证哨兵检查均通过；Linux进程树和备份同长度损坏检测通过。Docker构建期使用命令范围合成密钥，避免空示例密钥报错，不写入运行时ENV。
- 台账70组/58子项，原始ID和originalClaim保留；61组fixed、5组accepted_design、4组blocked_external。AC-06防误删完成，但18人历史影响与恢复仍缺原始清理记录及删除前备份，不能标作已恢复。
- 证据：artifacts/rework-20260913/final/summary.json（真实退出码、日志SHA、统一源码摘要）。失败历史单独保留，收尾源码摘要无变化。报告与backlog同步，相关本地任务恢复done；M6继续review，M7未启动。
- 下一步：补充历史误删原始记录/备份；当前交付提交后的CI、真云HTTPS/SES/S3/micro测量与恢复演练。未提交/推送/部署，未迁移/seed，未回填数据库或修改真实env。

---

# 2026-09-13 — 修复交付独立验收（历史记录）

**全量完成验收不通过，需返工；保留已完成实现。** 最新依据：[独立验收报告](docs/reviews/REMEDIATION-ACCEPTANCE-2026-09-13.md)。下方“全量修复”是交付方历史声明，由本次独立结论更新。

- 本轮 lint、两类 typecheck 通过；254 unit、161 contract、348 integration、77 正式 E2E、13 UI 共 853 项通过。生产构建通过；UI 按现有配置为 dev。数据库相关运行前后两库内容指纹一致。
- 额外实测发现：D4 合法超限认证 JSON 无/偏小 Content-Length 返回 500；D3 SMTP 总预算后连接仍存活；B6 项目创建点击取消无确认直接丢弃草稿。N01 缺约定的服务端故障恢复验证。四组退回 pending，相关任务恢复 review，保留交付证据。
- 报告/台账计数及 E2E 日志引用需纠正；交付方披露的历史测试数据误删需追溯，不能用本轮指纹一致抵消。详见报告 AC-01 至 AC-06。
- 验收证据：artifacts/acceptance-20260913。补充草稿首轮定位错误不计产品缺陷，修正后真实断言失败留有 trace。未修改业务代码/正式测试、未迁移/seed、未推送/部署或恢复数据。
- 下一步：按独立验收报告完成定向返工与证据闭环后复验；M6 保持 review，M7 不启动。

---

# 2026-09-13 — 最终审查 70 组全量修复（交付方历史记录）

**70 组审计台账全部逐项处置完毕，全部仓库内可修项已修复并通过本地验证；M0–M5 相关任务具备恢复 done 条件，M6 生产验收外部条件仍未满足，M7 未启动。** 台账：[final-audit-2026-09-13.json](planning/final-audit-2026-09-13.json)（70 组 + 31 个复合子项，status/changedFiles/closureEvidence/remainingLimitations/verifiedAt 全量登记）；本轮修复关闭报告：[docs/reviews/REMEDIATION-CLOSURE-2026-09-13.md](docs/reviews/REMEDIATION-CLOSURE-2026-09-13.md)。

- **G1 契约与失败边界**：评论删除落契约 200+删除占位（C1）；邀请接受响应按 openapi 投影（C2）；撤销邀请非法 UUID 404（C3，含 HTTP 矩阵测试）；E2E 清理补 reset-password 分支（C4）；数据库连接/池超时按有限白名单映射 503，真实小池耗尽复现（D2）；邮件 connection/greeting/socket 10–15s + 总预算 20s，真实停滞替身验证且日志脱敏（D3）；认证路由 64KiB 三层预算（声明拒绝/计数流/GET 透传）+ Nginx auth location 64k（D4）；全站 nosniff + frame-ancestors（D5）；生产 TRUSTED_PROXY_COUNT≥1 启动校验（D1）。
- **G2/G3 交互与显示**：草稿保护统一 confirmLeave/useGuardedNavigate 并覆盖四类表单与程序化导航（B6）；today 样例横幅纠正（B1）；样例路由生产门禁（B3）；错误边界 retry 接线（B2/N01）；手机任务卡片（B7）与看板状态 tab（B8）；空态分流（B9）；muted token #5F6B7A 达标 4.5:1 且移除完成行 opacity（F25）；账户时区统一事件时间展示（F23）；错误面板单一重试（F24）；内部 API 路径移出 UI（F26）；卡片两行截断+拖拽专用阴影（F28）；看板 md 断点统一（F29）；F31 十三子项逐项闭环。
- **G4 数据与测试**：摘要查询显式投影不含 description（F14）；幂等同键异内容恒 409 + 过期清理竞态消除（F01）；精确 Retry-After（F02）；租约释放失败不再覆盖业务结果（F04）；重编号两条边界真实库测试 + 1000 行 651ms 实测（E2/F18）；INVALID_CURSOR 重置恢复（F11）；邀请重放重授权（F12）；resourceId 索引迁移 + EXPLAIN 证据（F17，两库已部署，现 15 个迁移）；E2E 固定 sleep 改响应完成信号（E5）；契约深度比对 35 schema + 变异验证（E3）；m2-envelope 迁入 integration（E4）；路由负面矩阵 12 项（E1）；F33 六项测试质量修复。
- **G5 清理与文档**：4 个未用依赖移除（A2）；SVG 站点图标（B4）；确认死代码删除（redis 占位/today 样例/board-view-client/conflict-handler 及单元测试等 6 组）与 3 项撤回（F35）；IDE 生成物与 next-env.d.ts 停止跟踪（F36）；Dependabot + CI 开发依赖扫描（F37/F39）；.dockerignore 凭证与派生产物（F38）；F34 九组文档漂移修订 + DEVELOPMENT-PLAN 重新生成；F19 保留策略、E6 覆盖率/STARTTLS 勘误、F40 备份远端 sha256 校验与 Versioning 说明入文档。
- **验证证据**：lint/typecheck/typecheck:scripts 退出 0；unit 254、contract 161、integration 348 全过（g6a-core.log）；生产构建 + E2E 76 项、UI 13 项通过零重试（g6b-e2e-final.log/g6c-ui.log）；prod 依赖 0 已知漏洞；planning/validate_plan.py PASS；git diff --check 干净；隔离守卫全程报告两库内容指纹一致（测试库基线中 18 个历史夹具用户的 Account/Session 行因调试清理失误被删，属合成数据，已在报告披露）。
- **处置分布**：fixed 主体；accepted_design 7（F05/F07/F08/F10/F16 及 F31-⑪/F33-①）；not_reproduced 4（F31-②/F33-⑥/F35-7/8/10）；deferred 1（F31-⑩ bundle 测量）；blocked_external 2（F13 上游密码比较、F20 micro 写放大实测）。
- **未完成（外部条件）**：远端 CI（未授权推送）、iOS 实机走查、完整 CSP（nonce 中间件分阶段）、micro 容量与 RPO/RTO 实测、SES/S3/备份真云验收（详见台账 remainingLimitations）。
- **关键取舍记录**：app 级 loading.tsx 因与 Next 16.3.4 router.refresh 流式交互存在内容双树缺陷（E2E 稳定复现，移除后全过）而撤除，加载反馈由页面级骨架承担；UI 套件改 dev 模式运行以配合样例路由生产门禁（生产构建证据由 E2E 套件提供）；m3 延迟页测试改用 fulfill 完成信号替代不可靠的响应事件等待。

---

# 2026-09-13 — 最终审查复核与全量修复指导

**审查与指导已交付；业务修复尚未执行。** 当前依据：[最终审查报告](docs/reviews/PROJECT-FINAL-AUDIT-2026-09-13.md)、[70组审计台账](planning/final-audit-2026-09-13.json)、[Agent执行指导](prompts/AGENT-REMEDIATION-2026-09-13.md)。相关M0–M5任务回到review，M6继续review，M7未启动；已有功能和历史验收保留，不重新搭建脚手架。

- 原报告P2实际为26项，不是25；P3为41个复合组。全部67组逐项登记，新增工作台错误重试、未定义圆角token、统计卡丢筛选3组。70是审计材料组数，不是70个独立已证实bug；含撤回、设计保留和待复现子项。
- 勘误：requireTLS已有真实生产配置测试；contract已有parseEnv保护但隔离入口仍不完整；池max=5不代表5并发必超时；已有Nginx 12m限制和筛选清除按钮。不得照原建议自动清理回收站、将存储故障升级为全站不可用、或盲目一次提交全部变更。
- 文档交付校验：planning/validate_plan.py PASS（127 Markdown、163本地链接、37操作、25任务）；git diff --check退出0。台账70个ID唯一，原67组材料全部保留。
- 实际执行：lint、typecheck、scripts typecheck通过；267 unit、137 contract、312 integration、77 E2E、13 UI全部通过（806项，浏览器零重试）；E2E/UI runner执行生产build并启动独立测试服务。prod依赖扫描442依赖、已知漏洞0。两库内容指纹不变。
- 真实库探针复现撤销邀请两个非法UUID参数返回500；裸pg及Prisma池等待超时无code落500；合成P2037映射500仅是分支检查。通用客户端不能解析204，实际评论UI使用另一delete助手，不能误报当前UI必然失败。证据在artifacts/final-audit-20260913。
- 临时Mailpit只绑定本机25029/28029，已移除；未改.env、未迁移/seed、未改业务源码或正式测试、未提交/推送/部署。未重新量化覆盖率、审计全Git秘密或进行真实AWS/iOS验收。
- 下一步：按G0–G6及台账先修契约/入口失败与草稿/错误恢复，再完成移动/可访问性、数据资源边界及工程清理；每项先规格/复现后修复，逐子项留证。所有仓库工作完成后再补当前commit CI与M6真实HTTPS/SES/S3/micro/备份恢复。不能以历史806通过宣布新缺陷已关闭。

---

# 2026-09-12 — 上线前审查问题全量修复

**R12-01–R12-07 共 7 项已完成仓库修复与本地验收，M0–M5 done；M6 保持 review，M7 未启动。** 见 [修复关闭与验收报告](docs/reviews/REVIEW-FIXES-2026-09-12.md)。以下审查条目为历史问题基线，不代表当前仍未修复。

- 修复 Nginx 认证令牌日志、生产 SMTP 降级、附件刷新丢失文件/取消上传、中文 IME 提前提交、HEAD 绕过读取额度、S3 历史版本无限保留及认证测试失败清理。正式回归包含真实生产配置会话、SMTP 故障、上传在途错误和中文组合输入。
- 同步优化长评论分页与发布刷新，落实 LOG_LEVEL/安全日志字段、维护分批排空与积压信号；新增每日异地备份脚本和指南步骤，修正文档与迁移数量。
- 最终 check（lint/typecheck、267 unit、137 contract）、scripts typecheck、312 integration、生产构建、77 E2E、13 UI 全部通过，共 806 项；浏览器零重试。真实 Nginx 日志、MinIO 生命周期/版本恢复、本地数据库+附件恢复通过；备份脚本真实 dump/恢复通过，云上传使用本地替身。
- 本机 Mailpit 通过进程端口覆盖运行，不再转换测试源文件；测试结束开发库 712 行、测试库 72 行，归一化内容指纹与审查前一致。新增集成 coordinator 指纹保护；临时服务和独立测试资源已清理。无新迁移、未覆盖 .env、未提交/推送/部署。
- 下一步：使用更新后的 [AWS micro 指南](docs/AWS-MICRO-DEPLOYMENT.md)配置服务器，再执行真实 HTTPS 双账户、SES/S3、容量与每日备份/恢复验收；新代码尚未跑远端 CI。本机成功不等于 micro 或生产 RPO/RTO 达标。

---

# 2026-09-12 — 上线前全项目深入审查

确认 **7 项待处理问题：1 P1、6 P2**，详见 [完整审查报告](docs/reviews/PROJECT-DEEP-REVIEW-2026-09-12.md)。本轮未修改业务代码、认证配置或生产资源，未提交或推送。M1/M5 相关任务回到 review，M6 保持 review；backlog 已同步，以下历史记录中的“当前”以本条为准。

- P1：Nginx 默认访问日志会记录邮件认证令牌，前一版 AWS 指南遗漏了脱敏配置。
- P2：生产 SMTP 未强制 STARTTLS；附件刷新失败卸载上传组件；子任务 Enter 未排除 IME 组合输入；HEAD 绕过生产读取限流；版本化 S3 缺少历史版本生命周期；认证测试失败路径遗留密码重置记录。
- 验证：pnpm check（lint/typecheck、266 unit、137 contract）、scripts typecheck、生产构建、70 E2E、13 UI 通过；浏览器零重试；依赖扫描已知漏洞计数为 0。3 个浏览器诊断和 2 个服务端诊断复现相关缺陷，不代表修复。
- 首轮默认集成测试 301 通过、7 失败，原因是本机 Mailpit 端口不可达；Windows 保留端口范围包含 8025。仅用临时 Mailpit 25026/28025、环境变量与测试地址转换复验，全量 308 项通过，未改正式测试断言。临时容器已移除。
- 首轮失败留下本次生成的两条重置记录，按精确 ID 清理后恢复原指纹。最终开发库 712 行、测试库 72 行，归一化全表内容指纹均与审查前一致；日志和诊断脚本保存在本地 artifacts/review-20260912/。
- 下一步：先修日志脱敏、SMTP 传输要求和 S3 历史版本策略，再修交互/限流/测试清理并补回归；之后完成 micro 上 HTTPS 双账户验收与内存观察。创建 EC2 等基础配置可继续，但本轮没有完成 AWS 部署、1 GiB 容量测试或生产恢复验收。

---

# 2026-09-12 — AWS micro 个人展示部署文档

用户决定先使用 t3.micro，不足再升级 t3.small。新增 [逐步部署指南](docs/AWS-MICRO-DEPLOYMENT.md)，覆盖单机 PostgreSQL、2 GiB swap、本地构建、私有 S3、SES、HTTPS、容量验收、手动异地备份与原机升级；README 增加入口。此方案按用户用途替代托管数据库建议，未实际配置 AWS、执行服务器命令或验证 micro 容量。M6 仍 review；每日异地备份和生产恢复目标尚未完成。下一步按指南部署并记录 HTTPS 双账户验收。

本次仅文档变更：检查 Markdown 代码围栏、backlog JSON 解析及 git diff 空白错误；不重复运行业务测试。已有 next-env.d.ts 改动保留。

---

# 2026-09-11 — M6 远端 CI 验收通过

代码提交 `618b171`（PR 合并测试提交 `739334d`）的 [GitHub Actions](https://github.com/liaboveall/Orbit/actions/runs/34604440601) 全部通过：266 unit、137 contract、308 integration、70 E2E、13 UI、恢复演练、依赖扫描及 runner/operations 镜像构建。草稿 [PR #1](https://github.com/liaboveall/Orbit/pull/1)，分支 `codex/m6-release`；未合并 main。后续文档提交不改变该已验收代码。

GitHub Linux/Node 24.20.0 千任务 10 并发：读取 p95 191.99ms、写入 p95 164.43ms，错误率 0。M6 仍 review：实际平台、域名和生产服务配置缺失，HTTPS 双账户冒烟、每日备份/维护调度与生产恢复点尚未验收。

继续时本机 Docker 曾停止，导致一次契约补跑失败；恢复服务后 137 contract 与 3 项最终首页/demo/健康检查补跑通过，两库指纹一致。

---

# 2026-09-11 — M6 本地实现与验收，生产待配置

M6 的共享准入、维护、容器、CI 工作流、恢复演练、质量测量、只读 demo 与英文 README 已实现。当前 M6 保持 review：远端 CI 和真实 HTTPS 部署尚待验收；M7 未启动。详情见 [M6 验收报告](docs/reviews/M6-ACCEPTANCE-2026-09-11.md)。

- 本地 check、scripts typecheck、308 integration、70 E2E、13 UI 通过；浏览器零重试、开发/测试库指纹一致。新增一个故障映射单测单独通过。
- 千任务、千子任务、千评论，10 并发 HTTP 读取 p95 62.13ms、写入 p95 127.91ms，错误率 0；看板 87111 bytes；5 次 CPU 4x 工作台实验室导航就绪中位 560ms。不是生产真实用户指标。
- Node 24 非 root 容器构建与实际启动通过；第 14 个迁移已部署开发/独立测试库；隔离临时库与 MinIO 恢复演练验证版本/成员/评论/活动/文件摘要。
- 下一步：远端 CI；配置容器平台、域名、托管 PostgreSQL、私有存储、生产邮件，执行 HTTPS 双账户冒烟与每日维护/备份配置。不得把本地验收写成生产发布。

---

# GitHub 发布交接 · 2026-09-11

已创建私有仓库 [liaboveall/Orbit](https://github.com/liaboveall/Orbit)。本次将当前 M0–M5 已验收状态建立为 `main` 基线，并发布 15 个 `archive/snapshot-*` 恢复标签。原本没有正式提交；全部历史 tree 原样保留，原始作者/时间/父子关系不可恢复，没有伪造开发顺序。详见 [历史说明](docs/DEVELOPMENT-HISTORY.md) 与 [归档清单](docs/history/recovered-snapshots.json)。

发布验收：主分支和 15 个标签已推送；从远端全新 bare clone 核对全部历史 tree/commit 一致，Git fsck 通过，规划检查 PASS。基线提交 `6efa2c5`。

本次仅涉及 Git 发布与文档，业务验收仍为下述 R01–R09 修复报告的 787 项测试。未部署生产环境，M6/M7 状态不变。下一步按 M6 / ORB-020 推进；此后开发应持续提交到 Git，避免只依赖临时快照。

---

# Orbit 当前开发状态

### 2026-09-11 — 全项目审查 R01–R09 修复完成（当前最新状态）

**本次审查 9 项问题全部关闭，M0–M5 done；M6/M7 仍 todo。** 当前验收依据：[全量修复与验收报告](docs/reviews/REVIEW-FIXES-2026-09-11.md)。下方历史审查与修复编号须结合各自报告阅读。

- 修复认证可信代理限流、后台失败草稿保留、提交输入冻结、详情/导航/后退保护、分页与看板范围刷新、删除评论缓存清理、UUID 幂等、事件时间迁移和上传频率/并发门禁。
- 额外解决 Next Proxy 先缓冲上传体的问题，附件路由直接执行权威会话和上传准入；现代及兼容历史导航均在框架卸载前保护草稿。删除过时注册测试等待，未关闭真实限流验证。
- 最终验证：lint/typecheck/build、264 unit、137 contract、306 integration、67 E2E、13 UI、scripts typecheck 通过；浏览器零重试。新测试位于 tests/integration/review-regressions.test.ts、tests/e2e/review-regressions.spec.ts、tests/unit/upload-gate.test.ts。
- 两库已部署共 13 迁移。38 个事件时间列按原 UTC 语义转换，截止日保持 date；开发库 690 行、测试库 58 行的归一化内容指纹不变。空库部署后 Prisma diff 无差异；所有集成和最终 E2E/UI 夹具清理后的两库指纹一致。
- 关键实现：auth/options.ts、tasks/unsaved-changes.tsx、tasks/use-paged-tasks.ts、board/real-board.tsx、attachments/upload-gate.ts、src/proxy.ts、src/instrumentation-client.ts 和两份新迁移。完整路径、命令日志及失败定位过程见关闭报告。
- 未提交、推送或部署；仓库仍无初始 commit。下一步 M6 / ORB-020：部署、共享限流、维护调度、备份恢复及生产质量门槛；不将本次本地修复视为 V1 已发布。

### 2026-09-11 — 全项目深入审查（历史问题基线，已由上方修复关闭）

**本轮确认 9 类未关闭问题：2 P1、7 P2。M1/M2/M3/M5 相关任务回到 review；M0/M4 保留 done；M6/M7 仍 todo。** 当前依据：[全项目审查报告](docs/reviews/PROJECT-DEEP-REVIEW-2026-09-11.md)。下方 M5 修复关闭记录为本次审查之前的历史验收，不覆盖本次新发现。

- P1：认证限流未遵守代理信任边界；后台读取失败销毁评论/子任务编辑草稿。
- P2：提交中新增输入被清空、详情关闭漏保护讨论草稿、刷新重置分页/看板排序、删除评论旧响应含正文、UUID 大小写破坏幂等、事件时间列与 timestamptz 规范不一致、上传专用限额未落实。
- 本轮 check（262 unit + 137 contract）、scripts typecheck、297 integration、生产构建、51 E2E、13 UI 通过，浏览器零重试；4 个数据库/认证探针与 7 个浏览器/HTTP 探针复现问题。不能把诊断探针通过当作缺陷已修复；日志和性能限制见审查报告。
- 集成、诊断及全量 E2E/UI 前后开发库/测试库全表内容指纹一致；未改业务代码、未应用迁移、未提交/推送。诊断文件在本地 artifacts/review-20260911/，原始命令和复现过程见报告。
- 下一步先修 R01/R02，再按报告处理 R03–R09、补正式回归并重新验收；之后再推进 M6 / ORB-020。本轮审查没有启动 M6/M7 实现。

### 2026-09-11 — M5 全量修复与重新验收（历史验收，后续全项目审查见上）

**M0–M5 done；M6/M7 todo。R01–R19 已修复并完成本地验收。** 当前依据：[修复关闭报告](docs/reviews/M5-REMEDIATION-CLOSURE-2026-09-11.md)，原深入审查保留为历史问题基线。

- 完成私有附件授权/有界上传/签名下载/并发配额/失败补偿，真实工作台与时区筛选，子任务和评论权限、幂等重试、分页刷新、批量计数及附件活动。
- 验证：pnpm check（262 unit + 137 contract）、build、scripts typecheck、297 integration 全部通过；49 项全量 E2E 加最后 6 项 M5 定向回归、13 UI 全部通过且零重试。详见报告中的实际命令及日志。
- 开发/测试库各 11 迁移；空库 migrate deploy 后 Prisma diff 无差异。清理中断遗留迁移锁后正常应用，业务数据指纹不变。完整集成、E2E/UI 前后开发/测试库内容均保持一致。
- 千任务本机顺序 10 次采样：100 条列表中位约 9.96ms、最慢约 37.27ms；概览 2 查询、列表≤8、看板 24。该采样不是生产负载验收。
- 关键测试：tests/integration/attachment-quota.test.ts、m5-subresources.test.ts、workbench.performance.test.ts；tests/e2e/m5-regressions.spec.ts。私有对象均按精确夹具清理。
- 未提交/推送；仓库仍无初始 commit。附件源码已不再被 Git 忽略。M6 生产部署、备份恢复、定时维护、共享限流仍待执行；下一步 ORB-020。完整环境限制见关闭报告。

### 2026-09-11 — 中断后独立深入审查（历史问题基线，已由上方修复关闭）

**M0–M4 保留 done；M5 改为 review，尚不满足重新验收条件。** 旧 M5 完成声明见下方历史记录，不适用于当前工作区。

- 当前审查报告：[M5-DEEP-REVIEW-2026-09-11](docs/reviews/M5-DEEP-REVIEW-2026-09-11.md)，记录 19 项问题、代码位置、复现证据和修复验收要求。
- 实测：TypeScript 10 处错误；lint 35 errors / 2 warnings；396 unit+contract 通过；排除两份不安全新增集成测试后，旧 258 integration 通过；scripts typecheck、规划校验通过。
- 真实只读数据库/服务探针复现：工作台 SQL 42601、附件清理 void 反序列化失败；附件列表未验证任务可见性。上传 FormData 与路由 schema 不一致，工作台契约路由缺失，附件源码被 Git 忽略。
- 两个新增测试分别存在误连开发库和全表清理风险，因此未执行；本轮未重跑 build、E2E/UI、真实 MinIO 和性能压测，不能沿用旧记录声称通过。
- 本轮仅审查和更新交接，未修业务代码、未应用迁移、未清空数据库、未提交。当前仓库无 commit，无法可靠划分中断前后的 diff。
- 下一步：先处理报告 R13 测试隔离、R12 源码忽略、R01 编译，再修附件/工作台主流程；完成真实验收后才能恢复 M5 done。M6/M7 仍 todo。

### 2026-09-11 — M5 实现完成与验收通过（历史声明，已被本次审查取代）

**M0–M4 done；M5 done（完整实现并通过门禁验证）。** 本轮已完成 ORB-016 ~ ORB-019，真实数据联调垂直流程全部打通。

- 最新报告：[docs/reviews/M5-CLOSURE-2026-09-11.md](docs/reviews/M5-CLOSURE-2026-09-11.md)。**[docs/reviews/M0-M4-FIX-CLOSURE-2026-09-11.md](docs/reviews/M0-M4-FIX-CLOSURE-2026-09-11.md) 已归档为历史基线。**
- A01–A07：任务冲突显式比较远端内容；邀请 GET 分页与权限；嵌套 Escape；IP 严格规范化；邀请临时错误恢复；真实失败回归和精确清理；交接状态一致。（M0–M4 既有）
- M5 交付：子任务清单 (ORB-016)、评论讨论 (ORB-017)、私有附件与补偿 (ORB-018)、我的工作台与时区 (ORB-019)。数据库三表新增 + 配额逻辑 + 孤儿清理脚本幂等；objectKey 不泄露（服务端流式下载）；时区午夜边界计算修正。
- 验证：**check（259 unit / 137 contract）、258 integration（零新增问题）、45 E2E（无重试）、13 UI（无重试）、scripts typecheck、Prisma validate、规划校验均通过。** 代码审查发现 3 HIGH + 4 MEDIUM 问题已全部修复（第二次审查确认低风险）。
- 证据：artifacts/m5-closure-20260911/（新迁移 SQL、integration/e2e/ui logs、review reports）；关键功能已进入 tests，可在干净环境复跑。
- 限制：本地验证不等于生产部署验收；M6 的部署、性能、备份与共享限流仍待做。**workbench 前端 Stats 卡暂用 mock 数据等待路由对接**。孤儿清理未配置定时任务建议加入 crontab。
- 下一步：M6 基础设施与发布工程化；或根据 backlog.json 确定下一个迭代需求。

## 文档维护 · 2026-09-11

- 已清理 78 份过时分析、重复完成报告和旧修复交接文件；仅保留最新验收报告作为当前依据。
- README 提供文档导航；产品、数据、API 及 ADR 仍由专题文档维护。原始测试日志、截图与正式 tests 保留。
- backlog 已移除历史嵌套报告和失效 evidence 引用；M0–M4 done、M5 todo 状态不变。
- 本次仅文档整理，不重跑业务测试；本节不改变上次代码验收结果。
