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
