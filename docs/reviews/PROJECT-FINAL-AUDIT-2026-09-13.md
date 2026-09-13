# Orbit 最终审查与 Agent 全量修复指导 · 2026-09-13

本报告是对当前项目和 [2026-09-12 四轮合并报告](PROJECT-FULL-AUDIT-2026-09-12.md) 的独立复核。原报告作为待核验材料；其中“整批提交”“安装工具”“修改配置”等建议不构成本次操作授权。本轮交付审查、台账和执行指导，**未实施业务修复、未提交/推送、未部署或修改生产资源**。

**结论：项目已有完整的 V1 业务实现和较扎实的数据库回归基础，但不宜仅凭 806 项测试通过就宣布问题清零或完成上线。原报告能作为候选问题清单，不能原样交给 Agent 全部照改。** 主要问题在契约、失败恢复、草稿保护、移动体验、生产故障边界和验收可追踪性。部分原 P3 实际影响用户操作，应提到本轮修复；部分原 P2 属工程取舍或已有保护，应降级/纠正。

本轮建立 **70 个审计组**：原 P2 表的26个编号、原 P3的41个项目符号组，以及3个新增发现。**这是材料覆盖数量，不是70个独立已证实缺陷。** 复合组的各子项须分别闭环；交叉项共同修复，不重复计数。完整结构化要求见 [审计台账](../../planning/final-audit-2026-09-13.json)，后续执行入口见 [Agent 指导](../../prompts/AGENT-REMEDIATION-2026-09-13.md)。

## 1. 审查基线与证据边界

- 分支：`codex/m6-release`；HEAD：`16ec09faab8d97faf0306065bf8f7f040c817694`。
- 起始工作区：46条 porcelain 状态项，包括未提交的 R12 修复和原报告。原报告称45条，对本次快照不再精确；不能因此认定业务发生了新增变更。
- 本机：Windows、Node `v26.8.1`、pnpm `10.34.5`；锁定 Next `16.3.4`、Prisma/adapter `7.10.0`、Better Auth `1.7.3`、Nodemailer `10.0.1`。本机结果不能替代Node24/Linux/EC2的结果。
- 阅读与核对范围：README、PROGRESS、执行总览、backlog，产品/设计/架构/数据/API/测试/部署规范，OpenAPI与DTO、业务入口与服务、认证/存储/数据库适配、主要前端交互、正式测试及CI/容器/备份脚本。版本行为还核对了已安装库源码与Next随包文档。
- 本轮没有宣称逐行形式化验证所有文件、没有重复全Git历史秘密扫描、没有重做全部迁移/恢复演练。上一轮的这类结论仅作为历史证据。

### 实际执行结果

| 验证 | 实际结果 | 原始证据/说明 |
|---|---|---|
| `pnpm lint` | 通过 | `artifacts/final-audit-20260913/lint.log` |
| `pnpm typecheck` | 通过，生成Prisma client | `typecheck.log` |
| `pnpm typecheck:scripts` | 通过 | `scripts-typecheck.log` |
| `pnpm test:unit` | 20文件 / 267通过 | `unit.log` |
| `pnpm test:contract` | 9文件 / 137通过 | `test-contract.log`；本轮外包同一两库指纹保护 |
| `pnpm test:integration` | 26文件 / 312通过 | `test-integration.log`；真实PostgreSQL、Mailpit/MinIO |
| `pnpm test:e2e --retries=0` | 77通过 | `e2e.log`；配置先执行生产build，再启动3100独立测试服务 |
| `pnpm test:ui --retries=0` | 13通过 | `ui.log`；同样使用独立服务和指纹保护 |
| `pnpm audit --prod --json` | 442个生产依赖，已知漏洞0 | `dependency-audit.json`；这是查询时刻已知库结果，不是“无供应链风险”证明 |
| 定向数据库与客户端探针 | 见下表 | `probes.ts / probes.json`，仅测试库读取/失败回滚 |
| 文档/清单校验 | `python planning/validate_plan.py` PASS；`git diff --check`退出0 | 127个Markdown、163个本地链接、37个操作、25个backlog任务；不计入806业务测试 |

共 **806项正式测试通过**。没有修改断言、跳过失败测试或启用重试。测试日志仍包含Node警告和故障注入场景的预期错误，不能描述为“日志零警告零错误”。

为避开现有Mailpit无可用宿主映射，本轮使用临时本机容器 `orbit-final-audit-mailpit-20260913`，SMTP/API为25029/28029，仅通过测试进程环境覆盖；未改.env。结束时已移除。contract+integration外层、integration内部、E2E、UI和定向探针均检查开发库/测试库内容指纹，一致。未执行迁移、seed或批量清理现有数据。

| 定向探针 | 观测 | 裁定 |
|---|---|---|
| revokeInvitation非法projectId | Prisma P2010 → HTTP映射500 | C3已复现 |
| 有效项目owner + 非法invitationId | Prisma P2010 → HTTP映射500 | C3两个参数都需校验 |
| 独立pg池max=1，持有连接后等待100ms | Error、无code → 500 | D2已复现，等待预算为探针局部配置 |
| 同池经Prisma adapter查询 | Error、无code → 500 | D2不仅是裸pg假设 |
| 合成P2037交给映射函数 | 500 | 只验证映射分支；没有人为耗尽数据库全局连接上限 |
| parseEnv使用dev库作为测试库 | 拒绝 | E4“没有防误连校验”被反证 |
| parseEnv使用非test命名的customer_data | 接受，但探针未连接该库 | E4实际缺的是显式测试目标准入等完整防线 |
| 通用createApiClient接到204 | ApiClientError | C1兼容性缺口存在；当前评论UI走apiDelete，不能推导现有UI必然删除失败 |

这些探针证明的是**存在缺陷**，不是修复成功。原始运行产物在被Git忽略的本地artifacts目录；干净clone不会自动包含它们。可交接证据需要保留本报告/台账，并在修复CI中上传脱敏结果和对应提交标识。

## 2. 原审查报告的问题与纠正

### 2.1 计数、证据与结论力度

1. **P2总数错误。** A2项+B9项+C4项+D5项+E6项=26，摘要写25。P3实际是41个复合项目符号，许多一条含多个问题，“约55”缺少可复核拆分规则。
2. **把验证深度写成了质量保证。** “零新洞”“全覆盖”“全部跨平台可移植”“Git全历史无秘密”等广义判断需要明确边界与原始证据。本次只能说在已读路径和已运行测试中未新证实P0/P1漏洞，不能证明它们不存在。
3. **覆盖率近似并集不能推出完整保障。** 未重新安装coverage provider或重新计量；原87.1%/55.6%等本轮不背书。正确合并必须以同一快照的逐文件覆盖映射为基础；E2E触达也不等于错误分支被验证。
4. **历史CI不能覆盖未提交修复。** 本轮未查询远端Actions的最新状态。原报告提到的HEAD已通过CI只能作为其历史陈述；必须用最终交付commit的CI补闭环。
5. **定位与严重级混用。** 文件/函数存在不等于可达故障；没有favicon、unused依赖、无Dependabot与草稿丢失/错误契约不应平级。F21/F22/F24/F25以及下载失败边界更应优先。

### 2.2 会改变修复方向的勘误

| 原结论或建议 | 最终裁定 |
|---|---|
| E6：requireTLS生产分支无测试 | **误报。** `tests/integration/review-20260912.test.ts:20`以生产配置连接不提供STARTTLS的真实SMTP协议替身，并断言未发送AUTH；本轮整套312也运行通过。 |
| E6：无覆盖率百分比门禁就是缺陷 | **与质量规范冲突。** docs/07明确不设诱导无意义测试的覆盖率百分比。可补信息性覆盖报告，不能强设阈值让Agent堆测试。 |
| E4：contract完全无数据库守卫 | **部分误报。** 其parseEnv有黑名单/同名检查；但缺显式test库名、本地/实际库校验和前后指纹的统一入口，仍须修。 |
| D2：池max=5，所以5并发必触发超时 | **错误因果。** 连接占满后新申请才排队；是否超时取决于持有时间、等待预算与请求内查询方式。现有bug是异常映射，容量瓶颈需实测。 |
| D3：邮件失败“静默吞掉”，可用background handler解决 | **表述与方案不完整。** 应用已有auth_email_failed脱敏事件，库还记录错误；HTTP不传播不等于无日志。handler只改变等待方式，不提供可靠重试/投递保证。慢SMTP占用请求和连接资源，不等于同步阻塞Node主线程。 |
| D4：认证完全没有体积上限 | **范围错误。** 提供的Nginx location已有12m全路径上限；缺认证专用更小预算及应用流保护。直接源站的保护与代理保护要分别验收。 |
| D5：全站只有Referrer-Policy | **全局头确实少，但有局部例外。** 下载content已有nosniff。HSTS最终还需观察真实HTTPS代理响应。 |
| C1：删除评论会让当前客户端失败 | **缩小到契约消费者。** 通用client不处理204，但真实评论界面走apiDelete，接受204。必须修契约漂移，不能冒称当前UI必现报错。 |
| B9：任务页没有清除筛选入口 | **部分误报。** TaskFilters有“清除”；真实问题是空态未区分、上下文引导不明确。 |
| E2：renumberColumnAll负责中点间隙耗尽 | **函数归因错误。** position.ts的函数负责列尾bigint边界；move.ts的renumberColumn处理中点间隙，两种都应测。 |
| F01：普通重复uploadId并发必然P2002 | **缺少可达性证明。** 预留事务先锁Project再findUnique，同任务相同uploadId被串行化；需真实反例。 |
| F01：同键异内容409是“假409” | **语义错误。** docs/05明确要求409；应删除错误容错/死代码，不能“修成允许覆盖旧key”。createTask在begin前已确认项目可写，使所述缺失父项目分支更难从正常调用到达。 |
| F15：应增加音视频Range/seek | **超出V1。** 只允许PDF/图片/UTF-8文本且只下载；优先修超时和完整性，不新增播放器或Range需求。 |
| F16/F19：readiness必须含存储，软删除等必须自动清理 | **会破坏现有设计。** 存储故障按规范局部降级；回收站和撤销邀请明确保留。不能把“增长”作为删除用户数据授权。 |
| F33：中文role/name选择器少data-testid就是质量差 | **不成立。** role/name能检查可访问名称；仅在不稳定文案或复杂元素需要时使用testid。 |
| F39：开发库迁移是CI死步骤 | **不能直接删除。** 两库指纹和独立环境基线会涉及开发库；需追踪完整依赖。漏洞扫描随公告变化也不是应消除的“不确定性”。 |
| A1：全部45项必须一次原子提交 | **无必要且有混入风险。** 依赖完整的小批次也正确；.gitattributes与shell文件要保持换行策略一致，但不需要连所有业务/IDE变更一次提交。 |

### 2.3 仍应保留的正面结论

会话/成员/资源归属检查、Project/User锁、业务写与活动/幂等同事务、附件预留与补偿、对象私有下载、隔离测试和迁移纪律是已有实质工程成果。此次真实测试支持这些主要路径能够运行。后续Agent应在这个基础上补缺口，**不重搭脚手架，不全换技术栈，不把R12已修复项重新当未完成事项**。

## 3. 当前项目整体判断

| 领域 | 已有基础 | 仍需闭环 |
|---|---|---|
| 账户 | Better Auth邮件验证、重置、撤销会话；TLS拒绝降级、日志脱敏已有实现 | 邮件有界等待与中性反馈、代理部署校验、认证体积预算、自带端点边界 |
| 项目/任务/邀请 | 权限、配额、版本、软删除、真实并发测试 | 非法邀请参数、契约字段/状态、重放授权表达及极端排序验证 |
| 附件/评论/子任务 | 真实MinIO、流上传、配额预留、失败补偿、草稿后台失败保留 | 真实错误重试UI、评论Escape、租约释放故障、下载停滞/截断 |
| 前端 | 完整主要页面、键盘菜单代替拖拽、已有模态原语与分页 | 程序化导航保护、四种表单草稿、390px布局、对比度、时区、一致错误边界 |
| 数据/性能 | PostgreSQL单体、有限池、14迁移、真实数据回归 | 连接故障映射、摘要select、幂等缓存索引评估、重编号预算与micro实测 |
| 交付 | Node镜像、CI、操作手册、安全Nginx与备份脚本 | 当前提交CI、Docker上下文排除、Linux失败清理、真实云备份校验/恢复 |
| 测试 | 本轮806通过、独立服务/真实数据库/指纹保护 | 路由负面矩阵、契约语义比对、故障注入、确定性竞态、生产与iOS验收 |
| 规划 | V1/M7边界清楚，历史结果可追溯 | 最新审查未纳入原“全部完成”状态；本轮同步PROGRESS/backlog后按台账闭环 |

优先修**可达行为错误与生产失败边界**，再统一移动视觉，最后做有证据的性能/仓库清理。API漂移、用户输入损失、失效恢复和测试隔离应先于favicon、文案省略号、依赖更新工具等。

## 4. 原P2清单逐项裁定与验收

“确认”主要表示源码/规范可直接确定；“动态确认”还具有本轮针对性探针。两者都不表示已经修复。“修正”项包含有效子问题和需要撤回的原陈述。

| ID / 优先级 | 复核裁定与定位 | 修复/处置要求 | 验收证据 |
|---|---|---|---|
| **A1 · P2** 工作区完整性与当前提交验收 | **修正**。`git status`；`vitest.config.ts`；`src/server/auth/email.ts` | 保存基线与文件清单，按依赖完整的修复批次交付；提交前审查差异、未跟踪依赖及 shell 换行。不得执行原报告的盲目全量 git add/单次大提交。 | 干净 worktree/clone 能安装、构建、测试；CI head SHA 与交付提交一致；用户无关改动未混入。 |
| **A2 · P3** 四个未用依赖 | **降级**。`package.json`；`docs/03-ARCHITECTURE.md` | 核对静态/动态导入后删除无消费者的 query、sonner、react-hook-form、resolvers；同步 Forms 规划，不强制迁移全部表单。 | 冻结安装、构建和相关交互通过；以依赖图或镜像测量佐证收益，不能等同于全部进入客户端 bundle。 |
| **B1 · P2** 工作台误标合成数据 | **确认**。`src/features/shell/app-shell.tsx:isRealDataPath` | 把样例标记改为明确样例路由正向判定，真实 today 不挂 fixture 横幅。 | 真实用户 today 无样例标记，开发样例与公开 demo 保留准确标识。 |
| **B2 · P2** 页面错误恢复与加载边界不足 | **确认**。`src/app/app/today/error.tsx`；`src/app/app/layout.tsx`；`src/app` | 按共享布局配置合适 error/loading 边界；覆盖布局异常；按 Next 16.3 本地文档使用 retry，避免为每页复制同一文件。 | 项目列表/看板/详情/设置首次慢载有反馈；故障恢复会发新请求；不泄露服务端错误；嵌套布局错误也可恢复。 |
| **B3 · P2** 开发样例页在生产可访问 | **确认**。`src/app/app/layout.tsx`；`src/app/app/ui-samples/page.tsx`；`src/app/app/samples` | 在样例路由服务端设置开发环境门禁，保留公共 /demo；不要给整个 /app 加开发门禁。 | 生产构建直接请求样例路由不可访问；真实业务与 /demo 正常；开发环境样例可用。 |
| **B4 · P3** 站点图标与分享素材缺失 | **降级**。`src/app`；`public` | 补自有图标与基础 metadata；OG 可按展示需要补齐；manifest/PWA 不是 V1 必修。 | 图标响应成功、浏览器标签正确；不虚构 PWA 需求或引入图片生成依赖。 |
| **B5 · P2** 移动表单字号偏小 | **修正**。`src/components/ui/input.tsx`；`src/styles/tokens.css`；`src/features/tasks/comments/comment-list.tsx` | 对手机输入控件应用 16px 字号，核对覆盖 className；保留标签14px设计；禁止通过禁用缩放规避。 | 390px 下注册、任务、评论、设置输入可用且不挤压布局；iOS Safari 实机/可用模拟器验证自动放大，Chromium 不能代替。 |
| **B6 · P2** 程序化导航及四类表单缺草稿保护 | **确认**。`src/features/tasks/unsaved-changes.tsx`；`src/features/shell/app-shell.tsx`；`src/features/shell/user-menu.tsx` | 统一可取消离开入口；覆盖 router.push/replace、链接、前进后退、关闭及任务/项目创建、项目/个人设置。保存成功后解除保护，不把草稿写 URL/共享缓存。 | 每类草稿在取消导航、后台失败、IME及在途保存场景保留；确认放弃后可离开；成功保存后不多余阻拦。 |
| **B7 · P2** 手机任务列表仍为宽表格 | **确认**。`src/features/tasks/real/task-list-client.tsx:TaskTable`；`docs/02-UX-AND-DESIGN.md` | 手机转换任务行卡片，保留编号、状态、负责人、优先级、截止日及菜单；桌面保留语义表格。 | 390/768/1440px 长文本及键盘完成创建、打开、改状态，无主流程横向滚动。 |
| **B8 · P2** 手机看板缺状态标签切换 | **确认**。`src/features/board/real-board.tsx`；`docs/02-UX-AND-DESIGN.md` | 手机增加状态 tab 与列计数，保持筛选/分页/冲突回滚；菜单移动保持可用，不强制手机跨列拖拽。 | 三种视口、空列和满列可用；手机状态切换保留上下文；未加载完整仍禁止排序。 |
| **B9 · P2** 空态、完成态与筛选结果未区分 | **修正**。`src/features/workbench/task-list.tsx`；`src/features/tasks/real/task-list-client.tsx`；`src/features/tasks/real/task-filters.tsx` | 基于真实统计区分首次无任务、全部完成、筛选无结果；增加明确下一步。原报告称完全无清除按钮不准确，TaskFilters 已有清除。 | 空态各有正确CTA；已存在筛选清除仍可用；仅筛选为空不得声称全部任务完成。 |
| **C1 · P2** 评论删除返回状态与 OpenAPI 不符 | **修正**。`src/app/api/v1/comments/[commentId]/route.ts:DELETE`；`src/contracts/client.ts:safeJsonParse`；`src/features/tasks/api-helpers.ts` | 默认落实现有 OpenAPI 的200+删除占位Comment，复用deleteComment已有的脱敏DTO返回值，并同步实际调用客户端及测试；若决定204，先同步规范/契约/客户端，不能任选一边忽略另一边。 | HTTP与严格客户端验证状态、Content-Type、占位body=null、isDeleted=true及version；旧创建重放不泄漏正文。现有UI用apiDelete，不应误报为现有删除必然失败。 |
| **C2 · P2** 邀请接受响应多出 createdNewMembership | **确认**。`src/contracts/dto.ts:AcceptedInvitationSchema`；`src/server/modules/invitation/service.ts:acceptInvitation`；`contracts/openapi.json` | 明确公开响应字段；默认保留服务内部判断、对外按现有OpenAPI投影，或正式扩展契约。使必填/可选/strict一致。 | 新加入、已成员、owner、相同用户重放的HTTP响应均通过严格OpenAPI与Zod验证。 |
| **C3 · P2** 撤销邀请非法 UUID 返回500 | **动态确认**。`src/server/modules/invitation/service.ts:revokeInvitation`；`artifacts/final-audit-20260913/probes.json` | 在数据库调用前校验projectId与invitationId，非法业务ID统一404；保留owner权限和项目归属检查。 | 两个参数分别非法、混合大小写、有效但跨项目、非成员等真实HTTP用例返回约定状态，无500且无数据变更。 |
| **C4 · P2** E2E失败清理漏掉重置令牌 | **确认**。`tests/e2e/support/db.ts:cleanupTestEmails`；`tests/support/auth-cleanup.ts` | 复用精确用户归属清理规则；删除用户之前定位该用户reset-password记录；不按全部前缀清库。 | 重置申请后故意失败的teardown还原两库指纹；无关用户的未消费令牌保留。 |
| **D1 · P2** 生产代理误配会共享匿名限流桶 | **修正**。`src/server/http/client-ip.ts`；`src/server/auth/options.ts:createAuth`；`src/server/env.ts`；`docs/AWS-MICRO-DEPLOYMENT.md` | 保留默认0的安全信任边界；部署预检验证实际代理链、源站不可直连及明确配置。不能把默认值盲改为1；本指南的已配置拓扑与误配要区分。 | 两个真实来源独立计数；伪造XFF和内部头不能绕过；公共生产误配时失败或给出可观测警报。 |
| **D2 · P2** 数据库连接等待异常映射不完整 | **动态确认**。`src/server/http/errors.ts:toErrorResponse`；`src/server/db/prisma.ts`；`artifacts/final-audit-20260913/probes.json` | 在数据库适配层识别真实连接/池超时，安全归一为503；递归识别有限已知错误形状。不得将所有无code Error或所有P2028一律视为服务不可用。 | 真实小池耗尽、等待后恢复、拒绝连接映射503；未知编程错误仍500；P2037测试注明合成，不能冒充PG上限实测。 |
| **D3 · P2** 认证邮件超时预算和用户反馈不足 | **修正**。`src/server/auth/email.ts:getTransport/send`；`src/server/auth/options.ts`；`node_modules/better-auth/dist/context/create-context.mjs` | 设置连接/greeting/socket及总发送预算；保持账户枚举防护；提供中性反馈、限流重发和告警。后台handler不等于可靠队列，不自建邮件队列；如支持重复注册提示应使用库支持hook并防邮件轰炸。 | SMTP拒绝/无greeting/停滞都在预算内结束，日志无邮件地址/token；存在和不存在账户响应不泄露身份；重试通路可恢复。 |
| **D4 · P2** 认证请求缺少细粒度体积限制 | **修正**。`src/app/api/auth/[...all]/route.ts`；`infra/nginx.conf` | Nginx已有全路径12m上限；增加认证专用较小预算（建议64KiB，按协议验证），入口与实际流均有界；复制location时继承全部安全代理头。 | 有/无/伪造Content-Length、chunked超限在解析前拒绝；合法认证/回调不破坏；大请求不经clone产生无界副本。 |
| **D5 · P2** 安全响应头覆盖不完整 | **修正**。`next.config.ts`；`infra/nginx.conf`；`src/app/api/v1/attachments/[attachmentId]/content/route.ts` | 全站补nosniff、frame-ancestors等；CSP按Next本地指南分阶段验证；HSTS在真实HTTPS配置。附件content已含nosniff，不能称所有端点全无。 | HTML/API/下载/错误/重定向经Nginx核对；生产hydrate、登录、弹层、拖拽、上传可用；CSP不靠宽泛unsafe关闭保护。 |
| **E1 · P2** 子资源HTTP测试覆盖不足 | **修正**。`tests/integration/m5-subresources.test.ts`；`tests/contract/openapi-consistency.test.ts`；`src/app/api/v1` | 按评论/子任务/附件路由建立方法×状态×角色矩阵并直调Request或真实HTTP；不把service测试当路由覆盖。原0%数字本轮未重测。 | 覆盖401/403/404、400/409/413/415/422及归档/删除父任务/外项目ID；对照真实业务适用分支，不能每路由机械写全部状态。 |
| **E2 · P2** 关键排序/幂等边界未充分验证 | **修正**。`src/server/modules/task/position.ts:renumberColumnAll`；`src/server/modules/task/move.ts:renumberColumn`；`src/server/modules/idempotency/service.ts` | 分别验证中点无间隙和列尾bigint溢出（原报告混为同一函数）；先分析项目/用户锁是否使commit冲突不可达，再决定保留防御测试或移除冗余。 | 真实库小间隙/边界重编号顺序不丢、其他任务version不变；并发同键仅一次业务写；若专测事务失败必须在外部重查。 |
| **E3 · P2** 契约测试只比字段名且存在盲区 | **确认**。`tests/contract/openapi-consistency.test.ts`；`tests/contract/error-codes.test.ts`；`src/contracts` | 比较请求与响应的类型、required、nullable、enum、format、additionalProperties和约束；含AcceptedInvitation/BoardColumn.status；建立可审阅的单一来源/生成或互验流程。 | 故意变更字段类型/必填/枚举/状态码能使测试失败；输入默认值与输出必填语义分别处理；新旧两处漂移被测试捕获。 |
| **E4 · P2** contract写库缺统一隔离保护 | **修正**。`tests/contract/m2-envelope.test.ts:parseEnv`；`src/server/env.ts:NON_TEST_DB_PATTERN`；`vitest.config.ts` | m2-envelope迁入integration；或统一显式test库名、本地/实际库名、指纹保护。parseEnv已拒绝dev/prod和一般同名，原报告称无守卫错误。 | 错误库名/远程/同库启动前拒绝；纯contract无需数据库；真实信封集成测试继续运行，数量迁移有解释不丢断言。 |
| **E5 · P2** 固定等待的负向断言不可靠 | **修正**。`tests/e2e/m3-workflows.spec.ts`；`tests/e2e/m4-activity.spec.ts`；`tests/e2e/m4-project-list.spec.ts` | 用可控响应闸门、request完成信号与期望状态驱动竞态；page.clock只控制页面计时，不能单独证明网络响应已返回。 | 释放旧响应后验证其确实返回且页面未污染；测试在慢机仍有效，移除定时sleep后不丢竞态覆盖。 |
| **E6 · P3** 覆盖率/生产TLS/性能测试建议混杂 | **修正**。`docs/07-QUALITY-AND-TESTING.md`；`tests/integration/review-20260912.test.ts`；`tests/e2e/m6-quality.spec.ts` | 撤回requireTLS无测试说法；不强加覆盖率百分比，规范明确不要求；可补信息性报告。保持已定p95预算，实验室采样记录有限有效样本，不任意放宽门槛。 | 生产无STARTTLS测试继续通过且AUTH未发送；覆盖率注明套件/工具/排除；性能参数若可配置须记录原因、硬件和预算。 |

## 5. 原P3完整覆盖与分级处置

F01–F41按原报告§3.6项目符号**原顺序**编号，确保不漏项。复合组的括号内数量仅用于执行核对，不推导唯一缺陷总数。标记“待复现”的组里可能已有合理改进候选，未证实部分不能直接开修。

| ID / 优先级 | 复核裁定与定位 | 修复/处置要求 | 验收证据 |
|---|---|---|---|
| **F01 · P3** 幂等与重复上传的三种异常推断 | **修正**。`src/server/modules/idempotency/service.ts:beginIdempotency`；`src/server/modules/task/create.ts`；`src/server/modules/attachments/service.ts:uploadAttachment` | 删除或简化与规范相悖且不可达的resource-existence容错，不实现“不同body复用旧key”。重复上传在Project锁内重查，不能直接断言必现P2002；过期记录与维护delete竞态需用真实库闸门复现后处理。 | 同键异内容始终409且原记录不变；双上传返回READY重放或UPLOAD_IN_PROGRESS；过期记录与清理竞争不500、不双写。 |
| **F02 · P3** 读取Retry-After固定60秒 | **降级**。`src/server/auth/session.ts:requireSessionUser`；`src/server/http/errors.ts:domainErrorResponse` | 需要精确倒计时时将真实resetAfter随领域错误传递；60秒是保守上界，不是绕过。 | GET/HEAD额度一致；429等待值为正、有界且与桶剩余时间一致。 |
| **F03 · P3** 请求ID与content HEAD头一致性 | **修正**。`src/server/http/request-id.ts`；`src/proxy.ts`；`infra/nginx.conf`；`src/app/api/v1/attachments/[attachmentId]/content/route.ts:HEAD` | 部署入口已覆写请求ID，保留来源链路；直接源站仅信任已验证来源或自行生成；为显式405补请求ID，避免把字符集已过滤的ID当注入漏洞。 | 代理来的ID一致；恶意字符不反射；HEAD仍405且不下载文件。 |
| **F04 · P2** 上传释放租约失败覆盖成功结果 | **确认**。`src/app/api/v1/tasks/[taskId]/attachments/route.ts:29`；`src/server/modules/attachments/postgres-gate.ts:release` | 拆分业务结果与租约释放失败；已成功时保留成功响应并安全记录释放失败，依靠到期回收；原业务失败不被finally异常覆盖。 | READY成功后故障注入release失败不误报上传失败、不双扣配额；租约到期清理可恢复。 |
| **F05 · P3** 内存限流固定窗口边界突发 | **不作为缺陷**。`src/server/modules/rate-limit/memory.ts`；`src/server/modules/rate-limit/postgres.ts`；`docs/03-ARCHITECTURE.md` | 这是固定窗口策略的常见性质，生产普通桶也为固定窗口；保留既定策略和精确定义，不强换滑动窗口。上传专门滑动窗口仍按原需求验证。 | 文档明确窗口与峰值语义；假时钟测试边界计数；无重置桶绕过。 |
| **F06 · P3** Better Auth自带update-user扩大入口 | **修正**。`src/server/auth/options.ts:databaseHooks`；`src/server/auth/user-fields.ts`；`src/app/api/auth/[...all]/route.ts` | 列出实际开放认证端点和字段，限制V1不使用的image写入或关闭经依赖核对无用的端点；name/timezone已有数据库hook，不能误报全部绕过。 | 自有me与库入口校验一致；修改profile不绕业务限制；库自身限流与应用限流的差异有说明。 |
| **F07 · P3** 密钥长度与下载HMAC复用 | **不作为缺陷**。`src/server/env.ts`；`src/server/modules/attachments/service.ts` | 记录随机生成与轮换程序；现有带域前缀HMAC不因复用自动变漏洞。只有需独立轮换时再设计派生/独立key；不重写密码学。 | 轮换使旧会话/下载链接按预期失效；文档无真实密钥；长度校验不宣称能证明熵。 |
| **F08 · P3** 邮箱验证JWT可重用与自动登录 | **待复现**。`src/server/auth/options.ts:emailVerification`；`node_modules/better-auth/dist/api/routes/email-verification.mjs` | 用合成账户核对验证后再次点击、退出/重置后再次点击、过期及autoSignIn语义；先确定威胁模型，不将验证令牌与重置令牌等同。必要时用库支持选项关闭自动登录。 | 记录真实响应、会话签发情况与TTL；不能自写JWT/自建一次性认证协议或修改node_modules；升级风险记录。 |
| **F09 · P3** 姓名Unicode控制字符 | **确认**。`src/server/auth/user-fields.ts`；`src/contracts`；`src/features/members` | 集中拒绝危险控制/双向覆盖字符，保留正常中文、组合字符与可访问名称；核对成员展示的视觉隔离。 | 注册和两个资料更新入口规则相同；有正常国际化及恶意bidi用例；历史数据不粗暴清洗。 |
| **F10 · P3** int4版本计数极端耗尽 | **不作为缺陷**。`prisma/schema.prisma:version`；`docs/04-DATA-MODEL.md` | V1无证据接近边界，不为理论溢出全表迁移bigint；保留容量风险，必要时监测最大值。 | 风险记录有触发阈值；API数字类型、乐观并发不被无必要迁移破坏。 |
| **F11 · P3** 跨午夜旧游标失效体验 | **确认**。`src/server/modules/task/read.ts`；`src/features/tasks/use-paged-tasks.ts`；`src/server/modules/workbench/service.ts` | 保留日期参与游标指纹的正确性；遇INVALID_CURSOR重置查询窗口并提示，防止拼接不同日期结果。 | 可注入时钟跨午夜后重新读首屏、无重复/漏行/死循环；不得取消指纹校验。 |
| **F12 · P3** 创建邀请重放缺显式重授权 | **修正**。`src/server/modules/invitation/service.ts:createInvitation` | 重放前补明确当前可见性检查并约定归档重放语义；owner不转移、项目不永久删除限制了现实利用，不能称已证实越权。 | owner重放无token；归档、撤销、已使用邀请响应符合已明确规范；未来权限变化仍受检查。 |
| **F13 · P3** 库级密码比较的时序推断 | **待复现**。`node_modules/better-auth/dist/crypto/password.mjs`；`锁定的@better-auth/utils实际解析路径` | 追到真正工具包实现并确认比较方式，评估scrypt与网络噪声下可利用性。原报告“不可修”不成立，可评估官方修复版本/上游报告；不得自行替换密码哈希。 | 记录精确包版本、解析路径、调用链及官方处置；无证据不得升级为凭证泄露漏洞。 |
| **F14 · P3** 摘要查询仍读取description等大字段 | **确认**。`src/server/modules/task/read.ts:listTasks`；`src/server/modules/task/board.ts`；`src/server/modules/workbench/service.ts` | 采用明确select投影，调整mapper所需类型，移除摘要不消费的正文/关系；保留详情完整查询。 | 千任务且长中文描述下SQL选列不含description；DTO相同；p95、数据库传输/进程内存对比。原约1MB不是固定值。 |
| **F15 · P2** 下载总预算与完整性；Range不在V1范围 | **修正**。`src/server/modules/storage/client.ts:streamDownload`；`src/app/api/v1/attachments/[attachmentId]/content/route.ts`；`docs/01-PRODUCT-SPEC.md` | 给GetObject建连和整个流设置有界预算，合并客户端abort；保留流式背压，验证可信长度后传Content-Length并处理截断。V1无音视频允许类型且仅下载，不实现Range/seek。 | 慢存储、连接成功后停滞、取消、截断均能结束并留脱敏诊断；正常下载字节摘要一致；响应开始后不能再伪造JSON错误。 |
| **F16 · P3** readiness不检查存储 | **不作为缺陷**。`src/app/health/ready/route.ts`；`docs/03-ARCHITECTURE.md:健康`；`docs/08-ENVIRONMENT-AND-DEPLOYMENT.md` | 保留DB为全站ready条件、存储故障局部降级；可另加独立存储监测，不使MinIO故障下整个看板离线。 | 存储故障上传/下载局部报错，项目/任务仍可用；DB故障ready失败。 |
| **F17 · P3** 评论删除幂等缓存反查缺索引 | **确认**。`prisma/schema.prisma:IdempotencyRecord`；`src/server/modules/comments/service.ts:deleteComment` | 在代表性数据上EXPLAIN该更新路径，再按where形状增加resourceId或合适联合/部分索引；审阅迁移锁影响。 | 索引计划与执行时间有证据；删除占位与缓存正文清理仍原子；迁移可空库及增量部署。 |
| **F18 · P3** 两种重编号逐行UPDATE | **确认**。`src/server/modules/task/position.ts:renumberColumnAll`；`src/server/modules/task/move.ts:renumberColumn` | 先补E2两种边界测试并测量；必要时改参数化批量UPDATE，保留Project锁、原顺序、非移动任务version和updatedAt。 | 1000任务边界重编号在预算内；无原始SQL拼接ID；活动/boardVersion仅按业务变化增长。 |
| **F19 · P3** 邀请、移动历史、回收站保留策略 | **修正**。`docs/01-PRODUCT-SPEC.md`；`docs/04-DATA-MODEL.md`；`src/server/modules/task/move-record.ts` | 撤回自动清空回收站/撤销邀请的隐含建议：规范明确保留。核对MoveRecord是否幂等依赖，先列存量与增长模型；只有明确变更保留政策才做数据清理迁移。 | 保留/清理决策可追踪；软删除任务可恢复；不得因函数无读取者删表或永久删除用户数据。 |
| **F20 · P3** 页面访问与Postgres准入写放大 | **待复现**。`src/server/auth/session.ts`；`src/server/auth/options.ts`；`src/server/modules/rate-limit/postgres.ts` | 测量实际生产请求链及每页面数据库写次数；区分Headers式RSC读取与Request式API读取，不能把每次getSession当成业务读桶写。 | micro或等价受限环境记录查询数、pool等待、CPU/内存、p95；优化不引入跨用户缓存或关闭共享限流。 |
| **F21 · P2** 评论Escape无确认清空草稿 | **确认**。`src/features/tasks/comments/comment-list.tsx:onKeyDown` | 改为明确取消/确认放弃或保持输入；与详情关闭和嵌套Escape统一。 | 2000字草稿按Escape/IME不丢；取消放弃可继续编辑；确认放弃才清空。 |
| **F22 · P2** 权限丢失overlay导航与焦点错误 | **确认**。`src/features/activity/use-permission-loss-handler.tsx`；`src/features/activity/ActivityFeed.tsx` | 401引导登录；403/404/被移除退出项目回可访问页，清理私有列表；移除300ms强跳与无效定时器；用现有Dialog原语实现焦点隔离及token样式。 | 成员被移除无登录循环，无旧私有数据残留；按钮可操作；键盘焦点可控；卸载后不跳旧项目。 |
| **F23 · P2** 事件时间展示未统一用户时区 | **修正**。`src/features/tasks/comments`；`src/features/tasks/attachments`；`src/features/activity`；`src/features/invitations`；`src/features/settings` | 区分date-only截止日与UTC事件时间，事件展示显式传用户IANA时区或修正产品承诺；推荐统一格式化工具，不把UTC存储改为本地时间。 | 同一时间在Asia/Singapore与America/Los_Angeles显示正确；设备时区改变不影响账户设置；date-only不偏移。 |
| **F24 · P2** 真实错误面板混入样例重试按钮 | **修正**。`src/features/shell/state-views.tsx:SampleError`；`src/features/tasks/comments/comment-list.tsx`；`src/features/tasks/subtasks/subtask-list.tsx`；`src/features/tasks/attachments/attachment-list.tsx` | 将真实错误面板接收onRetry，删除样例toast及重复按钮；现有旁边“重新加载”确实有效，不能称完全不可恢复。 | 首次读取失败和后台失败分别恢复；只有一个明确重试动作；不清空草稿/已选文件。 |
| **F25 · P2** 文字对比度与完成行透明度 | **确认**。`src/styles/tokens.css`；`src/features/tasks/real/task-list-client.tsx`；`src/features/board` | 本轮公式确认muted/sunken=4.3518、muted/brand-soft=4.2882；调整文字token或背景组合；完成状态不用整行opacity压低文字。 | 普通文字≥4.5:1；逐实例检查透明度合成、焦点和禁用态适用性；三视口axe及人工核对。 |
| **F26 · P3** 内部API路径与实现文案进入用户界面 | **确认**。`src/features/projects`；`src/features/members`；`src/features/invitations`；`src/features/settings` | 移除真实页面的API路径/UUID装饰说明，替换为用户可用说明；保留开发文档中的技术细节。 | 业务页面无需理解接口路径；无私有数据进URL或日志的新变化。 |
| **F27 · P3** 文件大小格式化边界和单位 | **修正**。`src/features/tasks/attachments/types.ts:formatFileSize`；`src/features/tasks/fixtures.ts` | 核对实际双实现调用链；问题是接近1MiB时舍入可显示1024.0KB，精确1MiB原代码已转MB。统一KiB/MiB或明确十进制策略。 | 1023、1024、1MiB-1、1MiB、10MiB展示一致；不把格式化结果用于配额计算。 |
| **F28 · P3** 卡片标题行数与静态阴影 | **确认**。`src/features/board/real-board.tsx`；`src/features/tasks/real/task-list-client.tsx`；`docs/02-UX-AND-DESIGN.md` | 真实卡片标题按两行截断，详情完整可读；静态表面去除popover影子，浮层保留。 | 长中文/英文/URL不溢出；键盘可读完整标题；拖拽浮层与静态表面可区分。 |
| **F29 · P3** 断点选择与布局规范偏离 | **修正**。`src/features/board`；`src/features/shell`；`src/styles/tokens.css` | 围绕390/768/1440布局检查具体行为；使用sm/lg本身不是缺陷。统一手机tab/桌面列的切换点，不全局替换断点类。 | 断点前后核心操作可用、无消失控件、焦点回到可见元素。 |
| **F30 · P3** 省略号、复制提示和空态文案 | **确认**。`src/features`；`src/components/ui`；`docs/02-UX-AND-DESIGN.md` | 统一用户可见省略号和复制成功提示；成员空态CTA按角色给出。开发代码的...语法不能机械替换。 | 主流程文案一致、中文自然；无权限用户不显示无效邀请按钮。 |
| **F31 · P3** 零散前端项（13项，逐项闭环） | **修正**。`src/features/auth`；`src/features/invitations/InviteAccept.tsx`；`src/components/ui/dialog.tsx`；`src/features/settings/timezone-picker.tsx`；`src/features/workbench` | 逐项处理：①重发按钮真实重发或改名；②删除确认danger语义；③邀请错误中文；④输入错误aria-describedby；⑤关键触控目标44px；⑥skip-to-content；⑦/app可按导航需求重定向；⑧统计aria-current并入F32；⑨删确认无效networkError分支；⑩样例组件生产包先测产物再断言；⑪hover方向只是风格选择；⑫修token对比度注释；⑬IME下Dialog/时区Escape先复现，保留键盘取消。 | 各子项记录fixed/accepted/not-reproduced和证据；重点验证IME、表单读屏、390px触控；不全盘改样式/测试选择器。 |
| **F32 · P3** 工作台统计入口无选中态 | **确认**。`src/features/workbench/workbench-stats.tsx`；`src/app/app/today/page.tsx` | 统计卡接受当前bucket，增加视觉状态与aria-current；下方nav已有选中态，不应称所有分类导航无状态。 | 当前bucket两处入口一致、读屏可识别；不把重叠计数合计。 |
| **F33 · P3** 零散测试质量项（6项） | **修正**。`tests/unit/boundary.test.ts`；`tests/unit/rate-limit.test.ts`；`tests/e2e/auth.spec.ts`；`tests/e2e/m2-vertical.spec.ts` | ①优先保留role/name可访问选择器，必要时data-testid，不能因数量少认定缺陷；②boundary扩展.tsx；③清理死beforeAll并测试存在/不存在两分支；④纠正dev/test日志；⑤替换allowed是boolean的弱断言为固定时钟确切限额；⑥核对reload后真实值及持久化，不强迫所有E2E直查DB。 | 人为注入越界导入/限流失效/文案泄漏后相关用例确实失败；清理保留两库指纹。 |
| **F34 · P3** 规范、运维与注释漂移（9组） | **修正**。`docs/M6-OPERATIONS.md`；`docs/08-ENVIRONMENT-AND-DEPLOYMENT.md`；`prisma/schema.prisma`；`docs/03-ARCHITECTURE.md`；`docs/12-REFERENCES.md`；`docs/02-UX-AND-DESIGN.md`；`src/server/db/tx.ts`；`docs/05-API-CONTRACT.md`；`src/features/tasks/api-helpers.ts` | 逐组修订：维护批次/调度；当前14迁移与历史11/13标签；CHECK注释；实际目录与Forms决策；官方资料逐链接核验（域名存疑不等于假）；认证/成员路由；超时注释；错误码保留或移除决策；DELETE语义注释。重新生成DEVELOPMENT-PLAN。 | 规范与代码/契约一致，历史验收不被篡改为当前；validate_plan通过；官方资料与锁定版本兼容。 |
| **F35 · P3** 死代码候选清单（10组） | **待复现**。`src/server/modules/rate-limit/redis.ts`；`src/server/modules/task/position.ts`；`src/features/today`；`src/features/board/board-view-client.tsx`；`src/lib/conflict-handler.ts`；`src/server/modules/attachments/access.ts` | 逐个验证静态/动态/测试/脚本消费者：redis占位、position辅助、today样例、board wrapper、conflict-handler、barrel、tasks fixture导出、formatDueShort、附件access函数、空workbench目录。只删除被证实无用项；空目录不算Git产物。 | 删后冻结安装/类型/构建/对应演示通过；不因单次rg零引用删除公开入口、动态加载或恢复脚本依赖。 |
| **F36 · P3** IDE元数据与生成声明入库 | **确认**。`git ls-files .qoder .kiro`；`.gitignore`；`next-env.d.ts` | 本轮确认78个IDE文件；停止跟踪个人生成物并保留本地副本；按Next文档忽略next-env.d.ts，保证typecheck先生成。不要重写Git历史。 | 干净clone能typecheck/build；生成物不产生差异；用户本地IDE配置保留。 |
| **F37 · P3** Node版本范围与依赖更新机制 | **降级**。`package.json`；`.github/workflows/ci.yml`；`Dockerfile`；`docs/versions.md` | 统一支持Node范围、类型定义和实测矩阵；可加入Dependabot或等价受控更新。engine-strict为团队选择；别把未用依赖清理变成Next/Prisma跨主版本升级。 | Node24基线CI通过；若继续支持26则标记实际证据；更新PR冻结安装与全套验收。 |
| **F38 · P2** Docker构建上下文排除不全 | **确认**。`Dockerfile:COPY . .`；`.dockerignore`；`.gitignore` | 排除*.pem/*.key/*.p12/credentials及IDE/coverage/src/generated等派生产物，先核对构建确实重新生成客户端；operations目标含整个build层也需检查。 | 用合成哨兵文件构建两个目标验证不入层；不输出/打包真实凭证；构建仍通过。该风险不等于已发生泄漏。 |
| **F39 · P3** CI依赖扫描、浏览器缓存、dev迁移 | **修正**。`.github/workflows/ci.yml` | prod扫描保留，可追加开发工具依赖扫描；漏洞数据库变化是预期不是“不确定性缺陷”；浏览器缓存以实测决定；dev迁移承担两库指纹/干净环境基线，先追依赖再删。 | CI失败可定位；缓存键绑定版本/平台且失效正确；移除任何步骤后干净runner仍通过全部检查。 |
| **F40 · P2** 代理keepalive与备份校验/版本策略 | **修正**。`infra/nginx.conf`；`infra/backup-database.sh`；`infra/s3-backup-lifecycle.json`；`docs/AWS-MICRO-DEPLOYMENT.md` | ①keepalive以测量决定，低优先；②备份当前只比较长度、未核验远端内容hash，增加可信S3校验或下载校验及恢复演练；③备份桶如使用noncurrent策略需明确是否开启Versioning及成本/生命周期。 | 同长度损坏备份能被检测；真实异地上传及隔离恢复成功；日志不含dump内容；恢复点包含DB与附件版本。 |
| **F41 · P2** trace、进程清理和运维错误诊断 | **修正**。`playwright.config.ts`；`scripts/e2e-server.mjs:killProcessTree`；`scripts/maintenance-cleanup.ts`；`scripts/recovery-drill.ts`；`src/proxy.ts` | 零重试用retain-on-failure；POSIX按实际创建的进程组清理并验证Linux失败路径；运维记录安全错误类别/阶段/退出码而非原始message；proxy认证回跳注释按真实页面处理修正。 | 故意失败有trace；Linux测试超时/取消后无本次子进程或端口残留；不按端口误杀他人服务；错误诊断无秘密。 |

## 6. 本轮新增发现

| ID / 优先级 | 复核裁定与定位 | 修复/处置要求 | 验收证据 |
|---|---|---|---|
| **N01 · P2** 现有工作台错误重试不重新请求RSC | **确认**。`src/app/app/today/error.tsx:ErrorPage`；`node_modules/next/dist/client/components/error-boundary.js`；`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md` | 当前reset只清错误状态，retry才调用router.refresh并reset。把“重新加载”接到retry；与B2一起落实。 | 生产构建下临时RSC查询失败→恢复后点击按钮→确实发新RSC请求并恢复；不要只断言按钮可点击。 |
| **N02 · P3** 工作台使用未定义rounded-panel token | **确认**。`src/features/workbench/workbench-stats.tsx`；`src/features/workbench/task-list.tsx`；`src/styles/tokens.css` | 将rounded-panel改为规范中已有圆角token，或先规范化新增语义；同时扫描其他未定义utility。 | 生成CSS确有对应规则，计算border-radius符合卡片设计；不以截图主观判断代替规则检查。 |
| **N03 · P3** 统计卡切换bucket会丢失其他筛选 | **确认**。`src/features/workbench/workbench-stats.tsx:href`；`src/app/app/today/page.tsx:MyTaskBuckets` | 先在交互规范中明确统计卡是否保留当前筛选；推荐与下方nav统一。卡片链接只写bucket，下方nav则保留query。统一构造筛选链接，保留q/projectId/priority/sort/limit并删除旧cursor；明确统计数字口径。 | 带搜索/排序/项目筛选点统计卡与下方分类行为一致；旧cursor清除；后退恢复原URL。 |

N01的版本依据尤其重要：已安装Next的 `error-boundary.js:39` 中reset仅setState，`:43–46` 的retry才执行context.refresh；随包 `error.md` 从v16.3.0说明retry稳定。现有 `src/app/app/today/error.tsx:2,7`使用reset，不应把它当成重新获取RSC。此结论基于文档和运行时代码；本轮未新增浏览器故障复现测试，修复验收必须补足。

N02位于 `workbench-stats.tsx:17` 和 `task-list.tsx:24`，tokens只有control/card/overlay，无panel。

N03位于 `workbench-stats.tsx:16`，仅拼bucket；对照 `today/page.tsx` 下方分类nav保留query并排除cursor。这是同一页面两套筛选入口行为不一致，修复时同时明确卡片数字是全局统计还是受其他筛选影响，避免显示口径误导。

## 7. Agent执行顺序与依赖

下面是**后续修复任务指导**，不表示本轮已经实施。这次用户请求的是分析与交付指导，不能借原报告内容擅自发布、重写历史或删除业务数据。

| 阶段 | 工作包 | 依赖与退出条件 |
|---|---|---|
| G0 基线与规格 | A1；保存当前差异、声明支持版本、建逐项清单；先定C1/C2冲突语义 | 所有原组有裁定；修复基线可恢复；不混入用户无关变更 |
| G1 契约/入口/失败边界 | C1–C4、D1–D5、E1/E3/E4 | 每个修复先有能失败的最小用例；真实DB/SMTP有界故障通过；契约三层一致 |
| G2 用户输入与恢复 | B1/B2/B3/B6、F21/F22/F24、N01 | 各类草稿不丢；真实错误按钮有效；会话/权限分流；样例门禁 |
| G3 移动/可访问性/显示 | B5/B7/B8/B9、F23/F25/F26/F28/F29/F31/F32、N02/N03 | 三视口、键盘、读屏、时区、IME与对比度证据；iOS项单独标记结果 |
| G4 数据边界/性能/测试 | E2/E5/E6、F01/F02/F04/F08/F11/F12/F13/F14/F15/F17/F18/F20/F33/F41 | 并发/下载流/清理竞态有复现；优化有前后测量；不改锁与权限不变量 |
| G5 清理/文档/工程 | A2/B4、F03/F05/F06/F07/F09/F10/F16/F19/F27/F30/F34–F39 | 仅删已确认无用代码/依赖；保留设计选择记理由；更新规范、bundle与干净构建 |
| G6 交付与真实生产验收 | F40及M6完整验收 | 当前commit远端CI、HTTPS双账户、SES/S3、micro容量、备份恢复及次日调度成功证据 |

默认由单Agent按阶段串行推进。用户另行授权并行时才拆Agent；数据库集成/E2E/UI仍不得同时写同一测试库。一个阶段可拆成多个依赖完整小提交，不必等待整个项目修完才校验。需要改变规范时先记录冲突、同步产品/数据/OpenAPI/测试，避免通过改规范掩盖缺陷。

### 7.1 必须保持的数据与安全不变量

- User（必要时）→ Project → Task → 子资源锁顺序；网络I/O不进入持锁事务；业务版本冲突不能技术重试覆盖。
- owner/member/非成员权限和归档例外不变；输入路径ID只能定位资源，不能替代归属授权。
- 任务编号不复用；重编号不改变其他任务的业务version；DONE/completedAt一致；截止日保持date-only。
- 幂等同键异内容409；重放重新确认可见性；评论删除清除正文及旧幂等缓存。
- 附件流有界、预留/已用额度不重复增减；完成上传重新授权；取消不能承诺撤销已提交写；下载链接绑定用户且重查权限。
- 账户枚举防护、CSRF、受信代理头边界、TLS证书检查和私有对象存储不因“方便测试”削弱。
- 不新增Redis、WebSocket、微服务、组织层级、AI/M7、PWA、视频预览或永久回收站清理。
- 不编辑node_modules实现修复；只用锁定版本支持接口或经审阅的兼容更新。

### 7.2 测试必须证明修复而非迎合实现

1. 改变实现之前保存最小失败用例/诊断；修复后同输入通过。可达分支优先，纯视觉小修改不堆机械单测。
2. 路由测试真实构造Request，覆盖Origin、会话、路径、body限制、状态和响应schema；只有直接service调用不能证明HTTP正确。
3. 并发使用真实Postgres和可控屏障，不能用随机sleep碰概率，也不能mock事务/锁验证数据隔离。
4. 草稿用例：输入→导航/网络失败/远端刷新→取消离开/重试→内容与expectedVersion保留；保存中、IME、嵌套Escape另覆盖。
5. 故障用例：SMTP无greeting/拒TLS、池等待超时、S3建连后停滞/截断、租约release失败；保留安全日志和资源结束证据。
6. 性能优化先收集千任务长描述的SQL/内存/耗时基线；先保证结果相同再比较成本；不以增大阈值“修复”测试。
7. 新测试必须在错误配置时拒绝启动；测试失败也精确清理；不要清空共享库来恢复指纹。
8. 修复会改变测试计数，**806不是必须维持的目标数字**。迁移contract中的集成测试后要说明计数转移、断言仍覆盖。
9. 本地最终执行lint、typecheck、scripts typecheck、unit、contract、integration、生产build/E2E/UI、依赖扫描、规划校验；涉及迁移/容器/备份再做相应真实检查。不得把未运行的命令写为通过。

### 7.3 全量闭环的定义

台账每个组及复合子项最终取一种明确结论：**fixed（含证据）/ accepted_design（保持设计并解释）/ not_reproduced（记录方法与限制）/ deferred（触发条件与负责人）/ blocked_external（具体缺失条件）**。最后两种仍是未完成，不能计入“全部修复”；未复现不能伪装为已修复。审计台账初始的open也包含文档/工程处置，不能被计作62个已证实独立bug。

真正的修复完成需：所有确认缺陷关闭，所有误报明确撤回，所有保留设计有理由，所有未核实项完成复现裁定；发布完成还必须通过G6。每组保存变更文件、用例、命令/退出码、提交、证据路径、剩余限制。PR说明围绕最终行为，不复制原报告的大清单。

## 8. M6仍缺少的外部证据

本机测试与原报告都不能替代：

- 当前交付commit的远端CI与两个容器目标验证；本轮没有推送/创建PR/运行远端部署。
- 实际HTTPS域名、受信代理链、源站访问限制、安全头与真实双账户协作。
- SES真实投递、S3私有权限/版本/生命周期及故障告警。
- t3.micro的CPU、RSS/堆、swap、数据库连接等待与并发读写/上传容量；必要时升级small，不能用本机高配结果背书。
- 每日异地备份实际运行、次日成功记录、备份内容校验、数据库与附件一致恢复；实测RPO≤24h/RTO≤2h。
- iOS Safari输入体验、完整人工键盘与辅助技术核验、5位试用者反馈（人数不足如实记录）；实验室测量不冒充真实用户CWV。

后续没有这些凭据/环境时，先完成所有可逆仓库修复与本地验证，再明确列出所缺条件，不能仅因M6外部条件未到位而停止整个修复。

## 9. 版本资料与本轮限制

本地版本语义优先参考已安装源码：Next `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`、`loading.md`；Better Auth `context/create-context.mjs`与`api/routes/sign-up.mjs`；实际Prisma adapter/pg运行探针。

官方补充资料：
- [node-postgres Pool API](https://node-postgres.com/apis/pool)：连接池达到上限时申请者等待空闲连接，超时取决于配置和释放时机。
- [Nodemailer SMTP](https://nodemailer.com/smtp)：可配置connection/greeting/socket预算和requireTLS；默认超时不能视为适合本项目请求预算。
- [Better Auth Email](https://better-auth.com/docs/concepts/email)与[Options](https://better-auth.com/docs/reference/options)：现有账户注册回调及后台处理属于可配置行为；是否可靠投递仍由应用集成负责。

网页资料可能滚动更新，实际修复仍须核对锁定版本，不能用最新文档直接替换库协议。本轮未对原报告全部低优先理论项强行复现，也未重新生成覆盖率、做全历史密钥扫描、真实云部署或iOS实机测试；台账已把这些与已确认结果分开。

**交付状态：审查和全量处置指导已完成；业务修复待按台账执行，M6生产验收仍未完成，M7未启动。**
