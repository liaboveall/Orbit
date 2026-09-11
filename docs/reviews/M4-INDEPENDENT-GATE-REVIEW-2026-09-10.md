# M0–M4 最新交付独立复审与 M5 准入

审查日期：2026-09-10。对象：当前工作树、M4-CLOSEOUT-DELIVERY-REPORT-2026-09-10.md、docs/reviews/M4-CLOSEOUT-2026-09-10.md 及既有修复报告。报告中的建议不视为用户授权。本轮只审查，未修改业务代码、未实施 M5、未提交或推送。

## 结论

**不放行 M5。M4 保持 review，状态 M4_INDEPENDENT_REVIEW_REQUIRED。**

交付有实质进展：原先邀请人数/并发、活动刷新、未编辑字段误覆盖、归档入口等修复有效；正式 check、集成与 E2E 当前都通过。但独立测试复现了冲突恢复覆盖未展示的远端内容、IP 边界校验缺失、错误日志未脱敏；隔离运行既有 UI 断言还发现跨三种屏宽的 Escape 回归。默认 UI 测试仍写开发库，最终交付报告还错误指定了 M5 范围。因此不能将当前状态描述成“全部完成，只剩 Git”。

## 方法与实际证据

证据目录：`artifacts/m4-independent-review-20260910/`。检查实际源码与权限/事务边界，对照产品、架构、数据模型、API、测试、环境与 backlog；运行真实 PostgreSQL、真实认证/Mailpit 和浏览器。正式测试数量以此次结果为准，不沿用旧报告数字。

| 检查 | 本轮结果 | 日志 |
|---|---|---|
| pnpm check | 通过：lint、typecheck、229 unit、136 contract | check.log |
| pnpm test:integration | 19 文件 / 254 passed | integration.log |
| pnpm test:e2e --retries=0 | 31 passed，默认独立服务；过程中执行生产构建 | e2e.log |
| pnpm build | 通过，exit 0 | build.log |
| pnpm typecheck:scripts | 通过 | scripts.log |
| python planning/validate_plan.py | PASS；交接更新后再校验 | plan.log / plan-final.log |
| 独立邀请数据库探针 | 4 passed，真实配额/锁竞争 | db-probes-final.log |
| 独立安全探针 | 3 failed，均到达行为断言 | security.log |
| 独立设置冲突浏览器探针 | 1 failed；重试 HTTP 200，远端名称被覆盖 | settings.log |
| 既有 13 项 UI 断言，独立库 + next start | 10 passed / 3 failed，retries=0 | ui-isolated.log |
| 同一 UI 断言，独立库 + next dev | 10 passed / 3 failed，retries=0 | ui-isolated-dev.log |
| pnpm audit --prod --json | 2 high / 1 moderate / 0 critical | audit.json |
| 数据库迁移 | 两库与磁盘 7 个迁移 checksum 一致，均完成、无 rollback；各 8 条 CHECK | database-final.log |

UI 复验没有直接执行默认 `pnpm test:ui`：其配置会使用开发库。本轮复制原 spec 到审查目录，仅调整导入、添加邮箱捕获与精确清理，保留原测试断言；分别使用隔离的开发/生产服务。不能把该结果写成默认命令已通过，也不能因原报告写过 13 passed 而忽略当前失败。

## 必须处理的发现

### R1 · P1 · 冲突后远端获取失败，版本号仍自动前进

位置：`src/features/projects/project-settings-form.tsx:152`–`157`。

复现：初始版本 1；本地修改名称；另一请求将同一名称改为 Remote unseen change、版本升为 2；本地保存返回 409；拦截后续 GET 使其网络失败。界面未展示远端值，却把 baseline.version 改成 2。再次保存发送 `{expectedVersion:2,name:"Local draft"}`，返回 200，真实数据库名称变成 Local draft。

这不是之前“未编辑描述被附带覆盖”的同一条路径；之前的修复有效，但同字段冲突恢复仍可在用户无法核对远端内容时覆盖数据。提示要求核对“下方远端内容”，实际并不存在该内容。

验收：远端获取失败不得隐式推进编辑基准；保留草稿，提供重取远端的恢复路径。获取并展示最新内容后，由明确的用户选择决定采用远端或覆盖；覆盖仍需版本校验。覆盖网络错误及 GET 返回非 ok 的情况，独立 settings.spec.ts 应转绿，原 A06 必须继续通过。

### R2 · P1 · 默认 UI 测试与外部服务复用入口仍未形成完整隔离

位置：`playwright.ui.config.ts:23`–`26`；`tests/ui/m0-review.spec.ts:25`；`scripts/verify-e2e-target.mjs:46`–`86`。

默认 UI 配置启动 next dev、继承开发 DATABASE_URL，并允许复用已有服务；beforeEach 会真实注册用户、创建项目与任务，原 spec 没有对应清理。称“UI 写操作少，范围外”不能满足上一轮的测试隔离要求。

常规 E2E 默认路径已实质改进：测试库助手和专用服务核验独立本机库、专用端口、精确邮箱清理。本项不否认这一进展。但 E2E_BASE_URL 的核验只要求人工设置 E2E_ASSUME_TEST_DB=1、401 与 x-request-id；这些响应不能证明服务连接测试库。直接运行 Playwright 配置还可绕过 package pretest 脚本。

验收：UI/E2E 两个正式入口使用一致的隔离服务和 fixture 清理；把身份核验放入真正执行的启动链路。若不能可靠验证复用实例，就关闭该入口或仅允许由本次 runner 管理的实例；不需要公开数据库连接串。清理失败应使门禁失败；测试结束核实本轮用户/项目等无残留。计数相同只证明计数相同，不证明内容没被修改。

### R3 · P2 · 可信代理链长度和候选 IP 未校验

位置：`src/server/http/client-ip.ts:36`–`45`；相关现有单测把过短链仅断言为字符串。

独立探针：TRUSTED_PROXY_COUNT=3 且 header 仅一项时，函数返回该项，未退化为保守桶；TRUSTED_PROXY_COUNT=1 且 header 为 arbitrary-bucket-001 时，任意字符串直接成为桶键。根因是下标 clamp、删除空项、无 IP 校验。

风险边界：默认 count=0 确实忽略伪造头；不能声称默认部署已被任意绕过。启用代理配置且输入链异常、拓扑不一致或允许直达源站时，按 IP 的安全保证不成立。最终报告“过短/无效 IP 处理完备”与源码不符。

验收：不足层数、空段、无效 IP 必须保守处理，合法 IPv4/IPv6 做一致规范化；明确受信代理必须覆盖/追加哪些内容及源站访问限制。断言异常输入不能通过更换字符串获得新桶，保留真实 20/IP 与共享用户写桶回归。

### R4 · P1 · 错误日志截断不等于脱敏

位置：`src/server/http/errors.ts:128`–`131`。

当前删除控制字符后写入原始 message 前 200 字符，也保留原始 name。独立探针传入仅含合成 token/password 的 Error，捕获 console.error 后仍能完整找到 SYNTHETIC_SECRET_123。HTTP 500 响应是通用文案，这一保护有效；失败的是服务端日志边界，并非已证实真实凭证泄露事件。

验收：意外错误日志使用明确安全字段/错误分类，或在落盘前执行经过测试的脱敏策略。合成 password、token、cookie、连接串、signed URL 不应出现在输出中；不要以构建成功证明脱敏有效。

### R5 · P2 · 未保存草稿确认框 Escape 行为回归

位置：`src/features/tasks/task-detail.tsx:522`（内层 Dialog）及 `:547`（外层 Drawer）。

既有 UI 用例在 390、768、1440 三种屏宽均失败：打开草稿确认框，已等待“保留编辑”获得焦点，再按 Escape，确认框数量仍为 1（预期 0）。独立库上的 next start 和 next dev 结果相同，因此不是只在生产构建出现。其余 10 项通过。

当前证据定位于 samples 使用的 task-detail 组件；不能扩展声称真实任务编辑器的所有退出方式也失败。应检查嵌套弹层的 Escape 处理/关闭后重新打开及焦点恢复，并对真实 task-panel 同类交互复验。保留当前严格断言，不通过延时、删除测试或增加重试掩盖。

### R6 · P2 · 交付报告、入口状态和 M5 范围相互矛盾

最终交付报告第 242、328 行将 ORB-016/M5 描述为“批量操作与工作表视图”；实际 backlog 明确 ORB-016 为子任务清单，后续为评论、私有附件、Today。按报告交接会直接带偏实施范围。

最终报告写“收尾全部完成”；PROGRESS/backlog 仍标 partial/review；PROGRESS 又把已增加且本轮通过的 Markdown/表单测试、已修正的 docs/03 写成未完成。README 仍声称所有 E2E 共用开发库，而实际缺口主要在 UI/复用入口。validate_plan 的 PASS 没有检查出这些语义矛盾。

验收：统一一个最新结论和证据入口，历史结果标明历史。正确区分已完成项、失败项、未验证项与延期项；纠正 M5 范围，避免继续增加相互冲突的“最终报告”。本轮仅添加独立复审入口并同步当前状态，未改写历史交付报告以免掩盖证据。

## 已验证的进展及未扩大认定的风险

- 邀请配额计算包含 owner；不同 token 接受按 Project 锁串行；接受/归档、撤销/接受竞争通过独立真实数据库探针。旧探针等待 INSERT 的屏障已不适用于修复后的前置 Project 锁，本轮按实际阻塞语句调整同步屏障，未弱化业务断言。
- 活动刷新、旧分页响应在刷新后丢弃、项目列表 tab 切换、归档找回，以及未编辑字段冲突保护，通过正式 E2E。generation 前进发生在 effect，额外窄窗口未获得失败证据，本轮不把推测写成确定缺陷。
- 本轮 254 集成测试包含跨项目归属 6 项、移除成员权限/幂等重放 3 项和邀请限流 6 项。核心业务授权有实质覆盖；不宣称穷尽所有端点、角色与并发交错。
- 受限 Markdown 已有实际渲染与敌意输入测试，229 个 unit 中包含该文件。HTML 不作为 HTML 执行，图片语法不会产生 img；现实现会把图片语法内的安全链接渲染为普通链接，不能继续声称整段一定是纯文本，也未据此发现 XSS。
- 新增设置/任务创建表单的 429、500、网络失败场景已在本轮 E2E 通过，不能再笼统说没有失败恢复测试；它们没有覆盖 R1 的“PATCH 冲突 + GET 失败”组合。
- 依赖审计仍有 2 high / 1 moderate。当前使用 PostgreSQL adapter，未发现 mysql2 业务调用；deepmerge-ts 路径在 Prisma 配置链。没有证明业务可利用，也没有证明所有构建/部署场景绝对不可达；不能只因是传递依赖就写成安全无风险。记录修复版本、可达性与升级验证即可，不以未评估的跨主版本 override 作为审查动作。
- 分布式限流、完整性能/部署/备份属于 M6 或部署前工作，不要求全部提前完成才进入 M5；日志敏感信息边界与已交付功能回归应现在修复。读取限流等差距应有明确 backlog。
- 仓库无 commit，无法与某个交付 SHA 比较。本轮按当前工作树审查。用户此前并未授权提交，Agent 未提交不是业务修复失败；建立基线有利于下一阶段追溯，但不能替代上述修复。

## 审查自身的限制与清理

安全探针只使用合成敏感文本；设置探针只操作本轮测试用户/项目。独立 UI 副本为原断言补充了精确邮箱清理，未清空开发库。

旧数据库探针前两次因同步屏障与当前锁语句不匹配而失败，并导致异步请求与 afterEach 清理竞争；这些失败**不计为业务缺陷**。本轮用已核验的创建时间、name、email=id@audit.invalid 关系定位这两次合计 48 个 UUID 测试用户，验证项目名/归属后在事务内精确回收，见 cleanup-probe.mjs / cleanup.log。更新同步屏障后的最终 4 项通过并自行清理。

最终数据库状态：orbit_test 用户/项目均为 0，audit.invalid 用户为 0；orbit_dev 用户 173、项目 12，与审查中途快照计数一致，见 database-final.log。初次审查快照并非完整 E2E 开始前快照，不据此宣称对整个开发库完成内容级无变更证明。没有执行清库、强推或业务修复。

## 下一步与放行条件

先做一次限定范围的 M4 收尾：修复 R1、R4；关闭 R2 测试隔离入口缺口；修复 R3 输入边界和 R5 弹层交互；统一 R6 交接。将独立失败探针整理为正式回归测试，并保留已有通过项。无需再重构整个 M0–M4。

放行要求：当前 check/build/integration/e2e 与隔离后的正式 UI 命令通过；R1/R3/R4 探针转绿；测试清理证据有效；报告与 backlog 结论一致。之后从 **ORB-016 子任务清单**开始 M5，依据产品/数据/API 文档先做规格与验收，再做最小垂直流程；接着 ORB-017 评论、ORB-018 私有附件、ORB-019 Today。不要按错误报告实施批量操作/工作表。
