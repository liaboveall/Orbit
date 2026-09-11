# Orbit 全项目深入审查 · 2026-09-11

> 历史问题基线：本文 R01–R09 已完成修复和重新验收，当前状态见 [修复关闭报告](REVIEW-FIXES-2026-09-11.md)。下文保留审查当时的事实。

本轮结论：项目已有可运行的 M0–M5 主流程，原有门禁通过，但仍存在 **9 类已验证或有明确代码证据的问题（2 项 P1、7 项 P2）**。不能沿用“上一轮问题全部关闭”推导当前代码没有问题。M1/M2/M3/M5 的相关任务回到 review；M0/M4 保留历史验收状态；M6/M7 仍 todo。

本轮为审查，未修改业务实现、迁移或正常测试断言，未提交、推送或部署。测试只创建合成夹具，按精确 ID/邮箱清理；执行过数据库写入的验证均检查了开发库、测试库的全表内容指纹，结果见证据表。诊断探针位于本地 `artifacts/review-20260911/`，不进入正常测试套件；探针的“通过”代表缺陷现象被复现，不代表该行为符合验收。

## 审查范围与总体判断

- 以 README、PROGRESS、执行总览、backlog 为起点，对照产品、数据、API、设计、测试与部署规范，审阅认证/会话、项目权限、任务生命周期/排序、邀请/成员、子任务/评论、附件状态机/补偿、工作台、客户端刷新与分页、环境/测试隔离。
- 核对 package.json、已安装框架文档、Prisma schema/迁移，以及 Better Auth 1.7.3 的实际源码。认证 IP 信任规则另外核对官方文档。
- 现有优势：模块边界和运行时契约基本齐全；项目写锁、版本冲突、成员移除、附件最终提交前重验权限、私有下载、配额补偿均有真实数据库测试；本轮未复现新的非成员跨项目读取漏洞。
- 主要不足：正常成功流程覆盖充分，但“已加载数据 + 编辑中 + 后台失败”“提交中继续输入”“删除后重放”“等价 UUID 路径”和数据库会话时区等组合边界覆盖不足。新增探针在原有测试全绿的情况下仍能稳定复现问题。
- 生产准备仍有明确缺口：CI、生产容器/实际部署、健康检查、共享限流、定时维护、备份恢复、完整请求日志、真实并发性能/可访问性门槛属于尚未完成的 M6，不能当作本轮新引入的回归，也不能宣称已完成 V1 发布。

## 问题清单

### R01 · P1 · 认证限流没有遵守项目的代理信任边界

位置：[auth/options.ts](../../src/server/auth/options.ts#L112)、[client-ip.ts](../../src/server/http/client-ip.ts#L8)、[认证路由](../../src/app/api/auth/[...all]/route.ts)。

`TRUSTED_PROXY_COUNT=0` 时，自有邀请接口忽略用户传入的转发 IP；但 `createAuthOptions()` 没有配置 Better Auth 的 `advanced.ipAddress`。已安装版本默认读取单值 `x-forwarded-for`，认证限流因此不受项目现有 IP 解析规则保护。

实测：使用真实认证 handler、启用限流、`TRUSTED_PROXY_COUNT=0`，同一合成 IP 的前 10 个无效登录请求返回 400，第 11 个返回 429；只更换请求头中的 IP，后续请求立即又返回 400，说明重新获得独立限流额度。无密码猜测、无真实账户登录、无邮件发送。

影响：当前直接访问 Node 服务或未正确清洗请求头的部署下，客户端可绕过认证端点的限流。若未来网关强制覆盖头并阻止直连，风险条件会改变；当前仓库尚未提供该部署边界。此问题不等于绕过密码验证。

修复要求：统一认证与业务接口的 IP 信任策略；无可信代理时忽略可伪造头；配置代理时明确由哪个代理清洗哪个头，并阻止绕过网关的直接访问。不要通过关闭 IP 跟踪或限流解决。官方规则见 [Better Auth Rate Limit](https://better-auth.com/docs/concepts/rate-limit)。

验收：改变用户提供的转发头不能重置额度；受信代理后两个真实来源可正确区分；额外覆盖多跳代理和直连场景。

### R02 · P1 · 后台刷新失败会销毁评论/子任务的编辑草稿

位置：[comment-list.tsx](../../src/features/tasks/comments/comment-list.tsx#L212)、[subtask-list.tsx](../../src/features/tasks/subtasks/subtask-list.tsx#L167)、[use-resource-refresh.ts](../../src/features/tasks/use-resource-refresh.ts)。

两个列表在 GET 失败后设置 `loadError`，随后用错误界面替换整份列表。`CommentItem`/`SubtaskItem` 保存草稿的局部状态随组件卸载而消失。重新加载重新挂载的是数据库原内容。

浏览器实测（评论与子任务分别验证）：开始编辑 → 输入未保存文本 → 中断后续 GET → 触发窗口 focus → 列表出现重试按钮、编辑框消失 → 恢复网络并重试 → 再次编辑只剩原内容。30 秒轮询走同一刷新函数。

影响：用户无需主动导航或放弃编辑，一次临时网络失败就能造成草稿丢失。也违背设计规范“后台刷新保留已有内容”“网络失败保留草稿”。

修复要求：区分首次加载错误和后台刷新错误，已有内容及编辑组件持续挂载；如果需要卸载，将草稿提升到稳定且按用户/任务/子资源隔离的存储。保持 401/403/404 的权限失效处理独立。

验收：正在编辑的评论和子任务在离线、500、重试及远端版本变化下保持文本和原 expectedVersion；权限撤销仍及时退出。

### R03 · P2 · 评论提交期间继续输入的内容会被无条件清空

位置：[comment-list.tsx](../../src/features/tasks/comments/comment-list.tsx#L179)、[输入框](../../src/features/tasks/comments/comment-list.tsx#L269)；同类模式见 [subtask-list.tsx](../../src/features/tasks/subtasks/subtask-list.tsx#L131)。

评论提交只禁用发布按钮，输入框仍可编辑；请求成功后无条件 `setDraft("")`。回调没有检查当前文本是否仍等于已提交快照。评论成功后还要等待列表重新加载，扩大了这一时间窗口。

浏览器实测：提交 A，并暂缓成功响应 → 输入 B → 放行响应 → 输入框清空；数据库只包含 A，B 未被保存。子任务添加代码有相同的可编辑输入框与无条件清空模式，本轮没有单独做其延迟提交复现。

修复要求：提交中冻结对应输入，或仅在当前草稿仍匹配已提交快照时清空；响应属于旧草稿时保留新输入。

验收：延迟 POST 响应，继续输入、取消/重开或切换操作后，新草稿不会被旧请求回调清空。

### R04 · P2 · 关闭任务详情只保护父任务字段，没有保护讨论草稿

位置：[task-editor.tsx](../../src/features/tasks/real/task-editor.tsx#L246)、[子资源挂载](../../src/features/tasks/real/task-editor.tsx#L525)、[task-panel.tsx](../../src/features/tasks/real/task-panel.tsx)。

`close()` 只检查父任务编辑器的 `dirty`，评论输入和子资源编辑状态没有上报。用户填写评论但没有改动任务标题/描述时，关闭详情会直接移除整个面板。

浏览器实测：在列表侧面板输入未发布评论 → 点击“关闭详情” → 直接关闭，无放弃确认 → 再打开同一任务，输入为空。该问题与 R02 的网络失败卸载不同，需要将子资源草稿纳入关闭协调。

修复要求：建立详情内统一的未保存状态，关闭/切换时提供保留或明确放弃；上传进行中也应有明确的关闭行为。

验收：未提交评论、正在编辑的评论/子任务分别触发关闭保护；确认放弃才清除；单独关闭嵌套弹框不丢草稿。

### R05 · P2 · 自动刷新会丢弃已加载分页，并重新禁用看板排序

位置：[工作台列表](../../src/features/workbench/task-list.tsx#L32)、[看板](../../src/features/board/real-board.tsx#L58)、[项目任务列表](../../src/features/tasks/real/task-list-client.tsx#L84)。

客户端以首屏 props 的对象引用变化作为完整重置条件。`router.refresh()` 返回新的首屏数组，即使数据没有变化，也丢弃之前追加的页面。看板 `fresh()` 同样只获取首屏，成功移动后也会执行它。

浏览器实测：工作台加载 35 条（30+5）后触发 focus，列表回到 30 条；55 张卡片的看板点击“加载全部后排序”后可排序，focus 后又出现加载全部按钮，排序按钮禁用。项目任务列表具有同类重置代码，本轮未另跑该场景的浏览器探针。

影响：阅读位置和任务集合不稳定；大看板需要反复加载全部，自动轮询或一次写入即可撤销用户刚完成的加载操作。

修复要求：筛选/账号/项目变化与同上下文刷新分别处理；刷新当前已经加载的范围，或维持分页窗口并更新其中数据。继续保留旧请求代次保护，不能仅追加去重后忽略权限或筛选变化。

验收：工作台、任务列表、看板加载多页后，在 focus、30 秒刷新、写入后保持可用范围；真实筛选变化、成员移除与 boardVersion 冲突仍正确重置。

### R06 · P2 · 删除评论后仍能通过创建请求重放取回原正文

位置：[readCommentReplay](../../src/server/modules/comments/service.ts#L230)、[删除实现](../../src/server/modules/comments/service.ts#L371)。

删除路径清空 Comment.body，但创建操作缓存中的完整 CommentDTO 仍保留。重放只确认评论行存在且属于 taskId，没有按当前 deletedAt 输出删除占位，随后直接返回旧 DTO。

数据库实测：成员创建评论 → owner 删除 → GET 的 body=null → 原作者用同 key/body 重试创建 → 返回原正文，且 isDeleted=false。重放限于原作者的幂等记录和仍具项目权限的请求，不能据此声称非成员能读取任意评论。

规范问题：01/04 要求删除后清除响应正文，05 又有一般性的“其余接口按原响应重放”。应显式补齐删除后的评论重放例外，避免继续用一般幂等规则覆盖删除语义。本轮仅记录冲突，没有擅改业务规则。

修复要求：重放读取当前删除状态并返回删除占位或约定错误；同步决定是否清理缓存正文、修订规范并增加测试。

验收：owner 删除他人评论及作者自删后，GET 和旧 POST 重放均不再返回被删除正文。

### R07 · P2 · 等价 UUID 路径未归一化，破坏子资源创建幂等

位置：[评论 routeKey](../../src/server/modules/comments/service.ts#L154)、[子任务 routeKey](../../src/server/modules/subtask/service.ts#L131)。

PostgreSQL UUID 查询接受大小写等价值，但两个创建服务把原始 taskId 拼入文本 routeKey。同一个资源因路径大小写不同进入不同幂等命名空间；任务创建/恢复已有的大小写归一化没有统一应用到 M5。

数据库实测：同用户、同 Idempotency-Key、同 body，分别传小写和大写 taskId，创建出 2 条评论；对子任务同样得到 2 条。两个请求的父任务实际完全相同。

修复要求：在构造 routeKey 前使用权威 task.id 或统一 UUID 规范化，重放的归属比较也应使用一致形式。

验收：小写、大写、混合大小写路径使用同 key/body 只产生一条资源及一条活动；不同 body 仍返回 409。

### R08 · P2 · 事件时间列不符合 timestamptz 规范，非 UTC 数据库会话会写错时刻

位置：[Prisma Task 时间列](../../prisma/schema.prisma#L294)、[初始任务迁移](../../prisma/migrations/20260909004718_add_task_domain/migration.sql#L23)、[touchTaskUpdatedAt](../../src/server/modules/task/subresource.ts#L119)、[数据库连接配置](../../src/server/db/prisma.ts#L33)。

04 要求事件时间为 timestamptz/UTC，实际 schema 未声明 native timestamptz，迁移创建的是 TIMESTAMP(3) WITHOUT TIME ZONE。应用同时混用 JavaScript Date 和数据库 CURRENT_TIMESTAMP，连接池也没有显式固定会话时区。

真实数据库探针只在单个事务 `SET LOCAL TIME ZONE 'Asia/Shanghai'`，调用现有 touchTaskUpdatedAt 后，经 Prisma 读出的 updatedAt 相对当前时刻偏到约 8 小时以后。会话设置随事务结束恢复；夹具最终清理且两库指纹一致。

影响：当前本地 UTC 数据库可能表现正常，但换到不同默认时区的数据库后，更新时间排序、事件时间及混合来源的时间比较可能错误。它不是用户 date-only 截止日筛选算法的错误，也不能从本探针直接推断所有认证过期机制均已失效。

修复要求：先明确既有数据语义，再为业务事件时间设计安全的 timestamptz 迁移和转换；认证表按锁定库版本兼容性检查。禁止不确认旧数据含义就直接 ALTER 转换；date-only dueDate 继续保持 date。

验收：UTC/Asia/Shanghai/America/Los_Angeles 会话下同一时刻一致；迁移前后时间值和分页顺序符合预期，Prisma diff 及认证回归通过。

### R09 · P2 · M5 上传专用频率与并发限额没有实现

位置：[上传路由](../../src/app/api/v1/tasks/[taskId]/attachments/route.ts#L22)、[通用写限流](../../src/server/http/write-limit.ts#L6)、[架构规范](../03-ARCHITECTURE.md)。

架构规范明确“上传 10 次/用户/分钟且最多 2 并发”，并标为 M5 范围。当前上传入口只调用通用 60 次/用户/分钟写限流，没有独立上传桶，也没有跨任务的用户级在途上传计数。项目预留字节和单任务 5 附件上限不能替代用户级并发控制。

真实 HTTP 实测：在一分钟内发送同一合成小文件的 11 次合法上传请求，得到 201 + 10 次 200 重放，第 11 次仍被接收并执行文件接收/校验。并发缺口来自路由/服务代码审查，本轮未进行大量慢连接或资源耗尽实验。

影响：重试流量或多个任务同时上传可占用超出规划的临时磁盘、流处理与存储带宽。单文件 10 MiB、120 秒时限和项目配额已实现，但保护维度不同。

修复要求：落实用户级上传桶和在途并发门禁，成功、失败、取消、超时均释放并发名额；明确重放是否计频率及如何避免无界重复接收。多副本共享实现遵循既定 PostgreSQL 方向，不能借此引入 Redis。

验收：第 11 次请求、同用户第 3 条在途上传按规范被拒绝；不同用户独立；异常后名额可恢复且配额不重复释放。

## 工程与文档问题（不重复计入 9 项）

1. **仓库无初始 commit。** `git rev-parse --verify HEAD` 失败，文件整体未跟踪，无法可靠审查变更历史或证明 clean clone 可复现。未替用户提交或推送。
2. **交接入口混用历史结论。** README 顶部原指向 M5 修复关闭，底部“当前验收”和 tests/README 仍指向 M0–M4；PROGRESS 历史维护条目仍写 M5 todo。历史记录应保留，但必须明确当前结论，本轮已更新入口与审查状态。
3. **维护脚本不等于生产运维完成。** 附件待删标记依赖定时清理，当前未调度；幂等清理脚本拒绝 staging/production，后续需要正式维护入口及权限策略。不要将开发脚本直接当生产 runbook。
4. **性能证据边界。** 已有千任务数据库采样和查询条数断言，但不足以证明 10 并发下读取 p95≤300ms、写入 p95≤500ms，或 Core Web Vitals 真实用户分位达标。评论发布会主动从头串行加载所有页，在大量历史评论下需纳入性能验收。
5. **可访问性证据边界。** 现有键盘和多视口用例有价值，但本轮未新增完整 axe、200% 缩放、减少动画和三视口人工视觉复核，不能据此宣称最终设计验收全部完成。

## 实际执行记录

| 验证 | 本轮结果 | 本地证据 |
|---|---|---|
| pnpm check | lint、TypeScript 通过；262 unit + 137 contract 通过 | artifacts/review-20260911-check.log |
| pnpm test:integration | 22 文件、297 项通过 | artifacts/review-20260911/integration.log |
| pnpm typecheck:scripts | 通过 | artifacts/review-20260911/scripts.log |
| pnpm audit --json | 当前返回 0 已知漏洞；不代表无业务安全漏洞 | artifacts/review-20260911/audit.json |
| 4 个数据库/认证诊断探针 | 均复现预期缺陷现象 | artifacts/review-20260911/observations.log |
| 7 个浏览器/HTTP 诊断探针 | 4 + 3 项均复现缺陷现象，零重试 | artifacts/review-20260911/browser.log、browser-extra.log |
| 生产构建 | 诊断浏览器 runner 执行 pnpm build 后成功启动 next start | 上述 browser 日志与 playwright.config.ts |
| E2E_PORT=43127 pnpm test:e2e | 51 项通过、零重试，退出码 0，耗时 6.3 分钟 | artifacts/review-20260911/full-e2e.log |
| E2E_PORT=43127 pnpm test:ui | 13 项通过、零重试，退出码 0，耗时 25 秒 | artifacts/review-20260911/full-ui.log |
| 数据隔离 | 完整集成、诊断探针、两轮诊断浏览器及全量 E2E/UI 前后，两库内容指纹均一致 | 对应日志末尾 isolation |
| 规划校验 | 审查前及交接更新后均通过；最终 116 Markdown、91 本地链接、37 操作、25 任务 | artifacts/review-20260911/plan.log、plan-final.log |

诊断复跑：先运行 `pnpm exec tsx artifacts/review-20260911/run-observations.ts`；再设置 PowerShell `$env:E2E_PORT='43127'`，运行 `pnpm exec playwright test --config artifacts/review-20260911/playwright.config.ts`。不要与其他修改同一测试库的套件并行。诊断文件保存在被 Git 忽略的 artifacts；修复时应把对应“正确行为”测试纳入正式 tests，不能把观察缺陷的断言当作回归验收。

未执行：生产部署、共享限流改造、备份恢复、修改/重放数据库迁移、外部真实邮件供应商验证、完整生产负载测试。没有依据历史报告宣称这些工作在本轮完成。

运行限制：日志包含 Node 26 localStorage 实验性提示、NO_COLOR/FORCE_COLOR 提示，以及浏览器中断请求期间的 `destination stream closed early`。全量 E2E 中部分用例总耗时约 51 秒（包含夹具准备和清理），本轮没有进一步归因，不能把功能通过当作性能已达标。没有忽略断言失败或启用重试掩盖问题。

## 修复顺序与交接

1. 先修 R01 的认证 IP 信任及 R02 的后台刷新草稿丢失，并把探针转为应有行为的回归测试。
2. 补齐 R03/R04 的输入与关闭生命周期；连同 R05 分页保持，统一处理“同上下文刷新”和“切换上下文”。
3. 修 R06/R07 的删除重放和 UUID 规范化，同时同步冲突规范。
4. 处理 R08 时间存储迁移方案和 R09 上传限流；真实数据库与 MinIO 下验证。
5. 重跑门禁、集成、E2E/UI、隔离指纹，通过后恢复相关里程碑 done，再进入 M6 / ORB-020；M7 仍需用户明确要求。
