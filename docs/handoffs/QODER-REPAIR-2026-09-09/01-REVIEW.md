# Orbit 修复后二次独立审查（2026-09-09 23 时工作区）

**结论：修复有效，构建门禁和上轮核心移动缺陷已恢复；M3 仍未完成真实页面与异常场景验收。** 不需要重做已经正确的移动事务，但还不能推进 M4。

审查对象固定在 `artifacts/re-review-2026-09-09/source-manifest.json`。对比上轮指纹：19 个文件修改、5 个未接入查询/编辑 hook 删除、2 个文件新增；package.json、锁文件和数据库 schema 未变。尚无 Git 提交基线。检查后指纹未漂移。

本轮仅审查、创建交接资料并更新状态，没有修改应用源码、依赖、迁移或测试，没有提交 Git。探针仅创建唯一合成账户及其项目/任务，结束后精确清理。浏览器使用开发服务器；生产模式仅验证构建，未作压力或部署认证。

## 一、当前实际验证

| 命令/检查 | 结果 | 能证明的范围 |
|---|---|---|
| pnpm check | exit 0 | lint、typecheck、122 unit、136 contract 均通过 |
| pnpm build | exit 0 | 生产构建和类型检查通过 |
| pnpm test:integration | **exit 1** | 163 项通过；rate-limit.test.ts 一个 suite 收集失败；零跳过 |
| pnpm test:e2e | 8/8 | 现有 M1/M2 浏览器闭环通过，不含真实 M3 看板编辑流程 |
| pnpm test:ui | 13/13 | 样例焦点/响应式与真实详情读取通过，不证明详情保存可用 |
| 数据库迁移 | 开发、测试均 5 个，checksum 匹配 | MoveRecord 测试库缺迁移问题已解决；7 条 CHECK 两库均存在 |
| HTTP/数据库/浏览器补充探针 | 见 observations.json | 覆盖移动契约、落库、旧版本、归档、并发、日期、分页、认证、锁、UUID |
| 排序及归属补充探针 | 见 move-boundaries/observations.json | 无变化移动、bigint 上限、间隙重编号、跨项目详情路径 |

证据根目录：`artifacts/re-review-2026-09-09/`。测试日志均保存完整输出。探针脚本 `probe.ts`、`move-boundaries.ts`、`infrastructure-probe.ts` 可供复核，但其记录器不是全绿即完成的测试套件，必须阅读每项观测值；Qoder 需要把期望行为转成正式断言。

## 二、上轮 R1—R11 逐项复验

| 旧编号 | 当前判定 | 本次证据与剩余范围 |
|---|---|---|
| R1 构建门禁 | **已修复** | check/build exit 0；Hook/语法/边界门禁通过 |
| R2 移动契约与 500 后已写入 | **原问题已修复** | 标准请求 200；响应可解析，无 position bigint；活动与任务提交一致 |
| R3 移动版本/并发/活动 | **原问题已修复** | version 1→2；旧 PATCH 409；同 boardVersion 并发 200/409，仅递增一次；TASK_MOVED 存在。另发现 Q02/Q03 排序边界 |
| R4 归档仍可移动 | **已修复** | 合法移动体返回 409，状态/version 不变 |
| R5 M3 未接通 | **未完成** | 看板仍 fixture；真实详情保存零写请求，见 Q01 |
| R6 分页竞态 | **仍存在** | 同一任务两行，分别待办/进行中，见 Q04 |
| R7 认证失败处理 | **仍存在** | 登录 pending 卡住；退出 503 后仍登录且无提示，见 Q05 |
| R8 锁超时 | **仍存在** | 持锁约 5035ms 后 500，见 Q06 |
| R9 日期校验 | **已修复输入缺陷** | 不存在日期、带时间字符串、极端年份均 400；合法 date-only 201。范围决策需同步文档 |
| R10 限流 | **部分修复** | 429 已用 RATE_LIMITED；补充速度/覆盖范围/fallback 未修，见 Q07 |
| R11 UUID 重放 | **仍存在** | 大写路径首次 201、相同 key/body 重试 404，见 Q10 |

其他已修复：移动测试由跳过占位改为 11 项真实数据库测试并通过；单元测试 storage 环境和固定日期测试已改善；UI 旧 fixture ID 已改用真实合成详情数据；错误的未接入 TanStack Query hooks 已删除，Provider 也已移除第二套缓存；冲突工具改成纯逻辑，不再保留假合并请求。

**不要让下一轮 Agent 再实现一次旧 R2—R4，也不要恢复已删除的错误 hooks。** 继续维护现有通过项，只对新增边界和剩余范围做定向修改。

## 三、当前问题清单

优先级：P1 阻断当前核心交付，P2 正常行为/重要边界缺陷，P3 较少见边界。编号 Q01—Q10 是本次交接真源，与旧 R 编号分开。

### Q01 · P1 · 真实看板、详情编辑及列表上下文仍未完成

位置：`src/app/app/projects/[id]/board/page.tsx:31`；`src/features/tasks/real/task-detail-client.tsx:29`；`src/features/tasks/task-detail.tsx:205`；`src/features/board/board-view-client.tsx:75–90`。

浏览器复现：创建真实任务后打开项目看板，仍显示 CAMP 等演示任务，没有新任务。真实详情编辑标题点保存：写请求数为 0，GET 仍为旧标题，出现“样例模式：未连接真实后端”。详情的样例横幅这次已去掉，但写入尚未接通，更容易让使用者误认为能保存。

静态核验：

- 新增 `/app/samples/board/[projectId]` 保留了样例，但原业务看板路由仍调用旧 BoardView；侧栏仍是样例项目。
- BoardViewClient 仍无业务页面调用。即便直接接入，它还发送 `{newStatus,newPosition,expectedBoardVersion:task.version}`，与已修好的服务契约不符；api.post 的第二个参数误传请求 MoveTaskSchema，应为 MoveResultSchema。over.id 若为卡片 UUID 也不能当状态使用。
- 业务列表没有消费筛选 searchParams；看板 GET 契约的实现、同快照每列分页、真实详情侧面板和完整导航未交付。
- DraftManager/isVersionConflict 工具不等于真实表单具备保存、草稿恢复和 409 处理；详情仍调用样例组件的本地状态逻辑。

验收：按 ORB-010/011/012 完成真实业务路由；过滤 URL/关闭返回上下文保留；真实请求与页面状态一致；有响应丢失/409/离线恢复；每列分页、1000 任务、390px、键盘等价操作可验证。M5 评论/附件/子任务不在本轮实现范围，应明确呈现尚未开放状态。

### Q02 · P2 · 无语义变化的移动仍增加版本并写活动

位置：`src/server/modules/task/move.ts:207–259`；规格 `docs/04-DATA-MODEL.md §5` 明确要求 no-op 返回当前任务，不增加版本或活动。

复现：同列 A(1024)、B(2048)、C(3072)，请求“把 B 移到 C 前”。顺序及 B.position 完全不变，实际 B.version 1→2、boardVersion 4→5，又写一条 TASK_MOVED。

影响：无实际变化也使其他用户的旧快照冲突，污染活动历史。尾项再次移至尾部也需覆盖。

验收：在锁内校验输入合法性与 expectedVersion/boardVersion 后，按实际顺序判定 no-op；返回当前 DTO；task/project 版本、updatedAt、ActivityLog、MoveRecord、position 均不变。不能跳过版本/权限检查直接返回缓存。

### Q03 · P3 · 排序值接近 bigint 上限时没有重新编号

位置：`src/server/modules/task/position.ts:46`；`src/server/modules/task/move.ts:108`；规格 `docs/04 §5` 要求超界前重编号。

隔离夹具：将同列末项 position 设为 9223372036854775800（仍是合法 bigint），移动另一任务到列尾。实际 500 INTERNAL_ERROR；事务回滚，boardVersion 未变。缺少对 last+1024 溢出的处理。

这是极端合法数据的规格边界，不是本轮证明了正常使用很快会达到该数值。普通间隙耗尽重编号另经本轮验证：返回 200，顺序 A/C/B 正确，其他任务 version/updatedAt 未变，该能力应保留。

验收：append 和中点/首项边界统一检查；需要时在同一事务重编号再插入；检查正负边界和“不改其他任务版本/时间”。不要只扩大类型或捕获 500。

### Q04 · P2 · 在途分页响应污染刷新后的首屏

位置：`src/features/tasks/real/task-list-client.tsx:88,118`。

复现：51 条任务，暂缓第二页返回；把第二页任务更新到第一页，再通过页面操作刷新首屏，最后放行旧响应。同一任务出现两次，状态分别“进行中”和“待办”，并报告重复 React key。

根因：只重置已接收的 extraTasks，没有使旧批次请求失效。单纯去重也可能保留旧版本，不能作为完整修复。

验收：项目/筛选/刷新数据批次变化后，旧请求取消或忽略；只使用正确批次的数据及游标；任务列表和相同模式的项目列表一起检查。

### Q05 · P2 · 登录与退出的网络失败处理仍不完整

位置：`src/features/auth/use-auth.ts:64,113`；`src/features/shell/user-menu.tsx:55–65`。

复现：中断登录请求，页面抛 Failed to fetch，按钮持续“登录中…”且不可重试，无可见错误。退出接口返回 503，菜单仍硬跳登录页再回工作台，GET /me 为 200，没有退出失败提示。

验收：所有认证 hook 捕获网络异常并 finally 解除 pending；区分密码错误和服务失败；退出只有确认成功后走成功导航，失败提示并可重试。注册、重设、重发邮件同类代码一起覆盖。

### Q06 · P2 · 真实锁超时仍未经过承诺的重试/错误映射

位置：`src/server/db/tx.ts:59–69`。

复现：独立连接锁住合成 Project，再 HTTP 创建任务；约 5035ms 后返回 500。当前 collectPgCodes 仅沿 code/originalCode/cause 查找，未完整覆盖 Prisma 包装元数据。单改 timeout 不构成修复。

验收：用真实当前 Prisma/pg 错误验证解析、有界新事务重试、锁提前释放成功及预算耗尽 409；业务版本冲突不重试；错误不向客户端泄露 SQL 或凭证。

### Q07 · P2 · 业务限流仍不符合目标语义

位置：`src/server/modules/rate-limit/memory.ts:74`；`src/server/modules/rate-limit/redis.ts:108`；业务 route 层。

隔离时钟实测：配置 60/分钟，耗尽后推进 60 秒，只恢复 1 个 token，第二次即拒绝。业务代码搜索只发现 move 接入，其他项目/任务写接口没有统一纳入。

Redis 骨架的 isolated fallback 每次创建新 MemoryRateLimiter：maxTokens=1，三次都放行且创建三个清理 timer。此 fallback **没有接入当前 move 请求**，不能表述为线上已可利用漏洞；但不能当作生产能力保留虚假保证。

验收：明确每用户全部业务写的范围与计数策略，同一限制实例共享桶；耗尽/恢复/不同用户隔离测试通过；保持正确 RATE_LIMITED/Retry-After。按已定单实例方案处理，不借本轮新增 Redis 服务。

### Q08 · P2 · 集成门禁仍失败，限流测试还有数据库隔离隐患

位置：`tests/integration/rate-limit.test.ts:9–11,22–47`；`vitest.config.ts`。

实际 `pnpm test:integration` exit 1：163 项通过，但限流 suite 在 env 加载前静态导入应用 Prisma 导致收集失败。

更重要的是，该测试没有像其他集成测试一样将 Prisma 指向 TEST_DATABASE_URL，并使用 `email contains rate-limit-test` 的宽泛清理。**当前这次因收集失败没有执行它的写入**；若仅加 dotenv 后继续运行，会有连接开发库和误删其他测试账户的风险。不能以修复环境变量缺失为由照搬全局 DATABASE_URL。

验收：所有集成入口先强制核验独立测试库；不需要数据库的限流算法测试改成纯单元测试；确需 DB 的部分采用规范隔离 fixture，并按 runId 精确清理。整体 exit 0、零跳过、无 suite failure 才算通过。

### Q09 · P2 · 任务详情未校验路由项目与任务归属一致

位置：`src/app/app/projects/[id]/tasks/[taskId]/page.tsx:46–47`。

复现：同一合成用户拥有项目 A、B，任务属于 A；访问 `/app/projects/B/tasks/A的任务ID`，返回 200 并显示 A 的任务，返回看板链接却指向 B。

这里任务本身仍做成员权限检查，**不是证明用户能读取无权任务**；问题是上下文与资源归属不一致，违背页面说明的双重归属校验，后续侧面板/缓存/菜单会混淆。

验收：相同用户可见两个项目时，错误组合仍统一 404；正确组合 200；非成员、软删除任务同样保持 404。尽量把归属约束下沉到可复用读取边界。

### Q10 · P3 · 大写项目 UUID 仍不能正确幂等重放

位置：`src/server/modules/task/replay.ts:13–15`。

复现：大写项目 UUID 路径创建 201；同路径、同 key、同 body 重试 404。数据库 UUID 规范化后，代码做了区分大小写的字符串比较。

验收：UUID 输入/规范 routeKey 一致化；同 key 同内容重放正确、异内容保持 409；不放松成员、归档、软删除的重验。移动 beforeTaskId 的同类字符串比较也应补覆盖。

## 四、交付边界与工程观察

- M3 已有移动服务骨架和真实 11 项集成验证，应该迭代，不应推翻重写。间隙重编号、时间戳保护、归档与版本检查本次有正向证据。
- 当前仍是 Server props + createApiClient + router.refresh；此前错接的 5 个 hooks 已删除。可沿用此实现完成 M3，但必须由统筹同步 ADR-017/架构文档，说明后台刷新、失焦恢复、草稿保护如何实现；不能只删 Query 后忽略这些需求。
- 本地草稿工具只有 taskId 键，且目前未被真实编辑组件调用。接入前要明确 userId/projectId/taskId 隔离、过期与退出清理；此为设计前置，不是已证实的数据泄漏。
- dateInTimezone(timezone, now) 仍忽略 now；当前真实时区 E2E 通过，但建议统筹决定修复参数语义或移除兼容参数，并保留固定时刻午夜测试。不要让当前时间单测依赖运行日期。
- 1900—2100 限制已在运行时代码建立，OpenAPI/产品决策需同步；插首算法也与规格的“首项-1024、允许负数”不同。可以依据合理实现明确修正规格，但不能由并行专家各自选择不同规则。
- 检查通过不代表“全部接口一致”：openapi-consistency 仍只比较 spec 与手写操作清单；Q01 的 board GET 缺失不会被该检查发现。
- 锁文件与上轮一致；本轮未重复联网审计。上轮的 deepmerge-ts/mysql2 三条间接依赖公告仍作为升级跟踪，不升级为新的已利用漏洞结论。
- 未执行生产压测、完整1000任务看板、真实M3双浏览器编辑/拖拽/390px等端到端验收，因为对应业务页面未完成；不能填“通过”。本轮51条分页夹具与390px归属截图不替代上述测试。
- M4 邀请/成员/活动完整页，M5 子任务/评论/附件/工作台，M6 部署/求职材料不在本次开发授权范围。UI 可见的未开放功能应清楚说明。

## 五、推荐给 Qoder 的执行顺序

先修 Q08 使测试环境安全可用；后端补 Q02/Q03/Q06/Q07/Q10 并实现 board GET，认证专家独立修 Q05；前端在冻结的 board/move 契约上接通 Q01，同时处理 Q04/Q09。最后由独立验收角色执行所有命令和真实M3验收，逐项更新状态。

资料与提示词：`docs/handoffs/QODER-REPAIR-2026-09-09/`。文件职责和同目录协作边界见其中工作包，不要让多个专家同时编辑 contracts、全局 Provider、同一集成配置或 PROGRESS。
