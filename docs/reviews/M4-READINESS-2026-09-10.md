# Orbit · M4 准入独立审查

审查日期：2026-09-10（Asia/Singapore）。审查对象：当前工作区，包含 Qoder 最新修复。结论：**不能进入 M4；M3 保持 review。**

这次修复确实改善了认证异常、项目归属、位置溢出和限流补充算法，但 ORB-010/011/012 的真实使用流程仍未完成，而且测试数据库隔离出现回退。M4 的 ORB-013 依赖 ORB-012；目前依赖条件不满足。不能以“存在组件/工具函数”“构建成功”或历史完成报告替代验收。

## 范围与方法

- 对照产品、数据、API、实施计划、质量计划及 backlog 的 M3 验收条件，检查路由→组件→请求→业务→数据库的实际连接。
- 重跑检查、构建、单元、契约、数据库集成、现有 E2E、现有 UI；另用真实浏览器和 HTTP/数据库探针复验上轮 Q01—Q10，以及新增编辑边界。
- 审查开始保存 213 个源代码/测试/契约/配置文件的 SHA-256 清单；应用源代码未作修复。审查脚本和日志位于 `artifacts/m4-gate-2026-09-10/`。
- 本地 PostgreSQL 使用 Compose 的 `POSTGRES_HOST_PORT=5433` 启动，未终止系统 5432 上的其他 PostgreSQL。两库均可连接，故本轮数据库验收不再受 Docker 阻塞。
- **发现当前两个数据库连接均指向 `localhost:5433/orbit_dev` 后，没有直接运行原始集成测试命令。** 先确认独立 `orbit_test` 存在，再仅在子进程覆盖 TEST_DATABASE_URL。未修改 `.env.local`，未清空或重建数据库。
- HTTP/浏览器探针创建独立随机测试账户与项目，结束时按本轮账户/项目 ID 清理。现有 E2E/UI 使用其原有测试账户流程。没有执行 M4 功能开发。

## 本轮检查结果

| 检查 | 实际结果 | 解释/证据 |
|---|---|---|
| `pnpm check` | **失败，exit 1** | lint 8 errors；链式命令因此没有继续运行后续阶段。`check.log` |
| `pnpm typecheck` | 通过，exit 0 | 当前配置将 tests 排除；不代表测试代码类型正确。`typecheck.log` |
| `pnpm build` | 通过，exit 0 | 应用可以构建，但功能验收仍失败。`build.log` |
| `pnpm test:unit` | **120 passed / 2 failed** | 失败均为测试库隔离保护断言。`unit.log` |
| `pnpm test:contract` | 136 passed | `contract.log` |
| 隔离环境下 `pnpm test:integration` | **172 passed / 6 failed，exit 1** | 13 个文件，限流套件 6 项失败；178 项均已执行。`integration.log` |
| `pnpm test:e2e` | 8 passed，零跳过 | 复用本次 dev 服务，覆盖认证及 M2 纵向流程；没有真实 M3 看板/详情保存验收。`e2e.log` |
| `pnpm test:ui` | 13 passed | 主要为 M0 样例响应式、焦点和面板回归；不能代表真实 M3 页面闭环。`ui.log` |
| 补充测试代码类型检查 | **36 个 TS 错误** | 仅在审查目录添加独立 tsconfig，不改应用配置；错误在限流测试。`test-typecheck.log` |
| 两库迁移与约束 | 通过 | 开发库、独立测试库均 5 条迁移，checksum 匹配，7 条 CHECK 存在。`infrastructure.json` |
| `python planning/validate_plan.py` | **失败，5 个历史文档断链** | 本轮更新交接状态后运行；断链来自旧认证修复报告及 M3 完成总结，见 `plan-validation.log`；这不是应用测试。 |

集成复验命令：`node artifacts/m4-gate-2026-09-10/run-isolated.mjs test:integration`。这是本次审查的安全覆盖，不是仓库环境隔离已经修好的证据。

## 问题清单

P1：优先修复的安全/核心功能阻断；P2：当前范围正确性及验收缺口；P3：低频边界。下列“静态检查”与“真实复现”分别标明，不将未接入代码当成已运行功能。

### A01 · P1 · 测试数据库隔离被关闭

位置：`src/server/env.ts:140`；`tests/integration/rate-limit.test.ts:22`；本地环境配置。

当前 DATABASE_URL 与 TEST_DATABASE_URL 的目标库同为 orbit_dev。env.ts 将拒绝同库及非测试库名的校验整段注释，理由是 Docker 不可用。**同一个 PostgreSQL 实例内使用不同数据库即可隔离，不需要通过取消校验解决端口问题。** 原有两条隔离单测现在失败。

限流测试又先把 DATABASE_URL 改为 TEST_DATABASE_URL，再用连接字符串包含 `orbit_test` 来检查，既不能严格证明数据库身份，错误分支还会插入完整连接字符串。正常命令的其他集成套件可能在开发库写入/清理测试数据。本轮通过独立进程覆盖规避了这一风险；没有证据证明既有用户数据已受损。

验收：恢复统一的测试库校验，保持实际连接目标不同，连接前验证；错误不能回显凭证；当前环境默认命令能安全跑完整套件，同库与非测试库保护测试通过。RUN_TAG 是清理范围控制，不能代替数据库隔离。

### A02 · P1 · 真实看板缺失，不能只把现有组件接上就算完成

位置：`src/app/app/projects/[id]/board/page.tsx:1`；`src/server/modules/task/board.ts:22`；`src/features/board/board-view-client.tsx:87`。

真实复现：新项目创建真实任务后，看板仍显示“看板 · Orbit（M0 样例）”，真实任务数量为 0；`GET /api/v1/projects/{id}/board` 返回 **404**。当前路由调用的是 fixture `BoardView`。

静态检查：新增 getBoard 没有路由调用。内部使用可写项目检查，归档项目也不能读取；排序为 position DESC，与约定升序不符；分页方法仅从 getBoard 以 null cursor 调用，没有实际后续分页入口。游标只拼接 position/id，没有 boardVersion、筛选绑定等验证；也没有实现约定的查询参数与同快照分页冲突行为。代码注释称 REPEATABLE READ，实际调用统一 ReadCommitted 写事务并锁项目；应按规格实现读取策略，不能仅修改注释宣称一致。

未接入的 BoardViewClient 同样不完整：发送 `newStatus/newPosition`，缺 `expectedVersion`，把 task.version 当 boardVersion，且以请求 schema 校验响应。这些代码**不是当前线上请求**，但直接接入会失败。

验收：真实 Board GET、按列分页和快照冲突、真实页面、拖拽持久化、失败回滚、菜单/键盘替代，以及筛选/未完整加载时禁拖拽全部连通；归档看板可读不可写；AC-06 的真实 E2E 通过。

### A03 · P1 · 详情编辑请求错误，多项操作没有落库

位置：`src/features/tasks/task-detail.tsx:112`、`:132`、`:179`、`:274`、`:286`、`:356`、`:377`；`src/contracts/client.ts:138`。

真实复现：编辑真实任务标题，PATCH body 为 `{"body":{"title":"…","expectedVersion":1}}`；服务端返回 **400 VALIDATION_ERROR**，提示 expectedVersion 缺失和未知 body 字段，任务标题不变。客户端还错误传入 UpdateTaskSchema 作为成功响应 schema；即使只修请求体，返回的 TaskDTO 也会被错误校验。

继续点第二次保存，第二次仍 400，但按钮一直禁用并显示“保存中...”。finally 读取上一次渲染的 saveError，不能可靠清除 pending。

真实手机页面上点击“标记为已完成”：界面显示已完成，**0 个写请求**，GET 仍为 TODO。点击“删除任务”：**0 个写请求**，GET 仍 200、deletedAt 为 null。优先级和状态选择器静态检查也只是 setState 加 toast。

验收：所有当前开放的编辑操作发送契约正确的请求并持久化；使用 TaskSchema 读取响应；失败和重复重试均恢复按钮；明确权限及归档只读状态；关闭、刷新和重新进入后的显示与数据库一致。后续 M5 的评论/附件本轮不要求实现。

### A04 · P2 · 草稿会丢最后一次输入，409 恢复流程未完成

位置：`src/features/tasks/task-detail.tsx:147`、`:189`、`:207`、`:308`、`:420`。

真实复现：输入 `Draft ABC!`，本地存储实际为 `Draft ABC`；刷新后恢复的也是 `Draft ABC`。onChange 在 setState 后立即读取旧 state 写入存储，导致滞后一次输入。标题菜单入口也没有像点击标题本身一样加载草稿。

静态检查：409 分支只有 toast，没有重新读取最新版本并让用户选择如何继续；相同旧版本重试无法完成编辑。存储访问缺少异常防护。草稿 key 已包含用户/项目/任务，属于改进，但不等于完整草稿验收。当前真实保存先被 A03 的 400 阻断，不能声称 AC-05 已在页面验证。

验收：最后一个字符、清空文本和多字段草稿都准确保留；刷新/重新聚焦/30 秒后台刷新不覆盖编辑；两个真实浏览器产生 409 后能保留草稿、读取新版本、明确处理冲突并成功保存；存储不可用时主流程不崩溃。

### A05 · P2 · 真实列表缺详情入口和 URL 筛选

位置：`src/features/tasks/real/task-list-client.tsx:333`（TaskTable/TaskRow）；`src/app/app/projects/[id]/tasks/page.tsx:36`。

真实列表里的任务标题只是 span，没有详情链接/点击导航；手机实测该任务的详情链接数为 0。页面不接收 searchParams，列表读取只传 limit，未实现既定筛选 URL。详情独立路径虽然能手动打开，却不能从正常任务列表完成查看流程，关闭后的上下文也没有完整接通。

验收：从真实项目列表可用键盘和 390px 手机进入详情；桌面侧面板、独立链接及返回上下文正确；搜索/筛选/排序写入 URL，刷新和切换视图保留适用参数，筛选切换重置分页。对应 ORB-010、AC-11。

### A06 · P2 · 列表刷新后仍混入旧分页

位置：`src/features/tasks/real/task-list-client.tsx:94`、`:100`、`:141`、`:148`。

真实复现：51 条任务，延迟“加载更多”响应；更新最后一条的状态并触发首屏刷新，再释放旧分页。同一任务出现 **2 行**，状态分别为“进行中”和“待办”，浏览器报告重复 React key。

根因：把首屏数组和 extraTasks 比较不等于检测首屏版本改变；shouldReset 可以连续保持 true，effect 不重新执行；首屏变更没有递增批次或清空旧分页。新增 AbortController 没有解决本次竞态。

验收：以项目/筛选/首屏刷新代次管理分页；旧响应不可提交；初始数据变化应清理已追加片段和游标；补真实延迟响应回归，不能仅按 ID 去重掩盖过期状态。

### A07 · P2 · 实际锁超时仍未进入重试/预期错误映射

位置：`src/server/db/tx.ts:61`、`:159`、`:166`。

真实复现：对本轮项目持有 FOR UPDATE 锁，再通过 API 创建任务，约 **5,030ms** 后返回 **500 INTERNAL_ERROR**。服务日志确认 PostgreSQL `55P03`。当前错误码提取没有识别本机 Prisma/adapter 实际包装的该错误，所以新增重试和 LOCKED 映射未生效。

验收：按实际错误结构提取底层 SQLSTATE；短暂持锁后释放可重试成功；持续持锁在有限预算后返回约定可恢复错误；每次重试开启新事务，业务版本冲突不做技术重试；以真实数据库测试覆盖。

### A08 · P2 · 质量门禁不绿，测试类型错误被排除在常规检查之外

位置：`tsconfig.json:43`；`tests/integration/rate-limit.test.ts:90`、`:198`、`:226`；`.qoder/projects/d--FullStack-Orbit/canvases/M3-expert-team-completion.canvas.tsx:154`。

lint 的 8 个错误：Qoder canvas 的 H3 未定义 4 项、env.ts 未使用变量 3 项、限流测试未使用 import 1 项。单元测试失败见 A01。隔离库下限流集成测试实际 6 项失败，不能仍写“163 项通过，已完成”。

限流测试以 10 token 实例执行，却多处期待 2～3 次请求后耗尽；有些用例更换 operation key 后仍期待共享耗尽，断言与测试设置不一致。不能直接将这些失败全部解释为业务限流器故障。测试还把已 await 的实例标成 `Promise<unknown>` 等，补充类型检查得到 **36 个错误**；当前 tsconfig 排除 tests，因此 pnpm typecheck 通过未覆盖这些问题。Qoder canvas 不是应用页面，H3 错误不等于真实任务页面运行时崩溃。

验收：修正测试设置、身份 fixture、生命周期和类型；让应用与测试均有明确类型检查入口；合理隔离 IDE 生成的 canvas 文件，不通过排除真实测试或删除断言变绿；正常安全环境下所有本轮检查完整通过。

交接文档验证另外发现 5 个既存断链：`artifacts/M2-AUTH-NETWORK-ERRORS-VERIFICATION.md` 的 4 个相对路径，以及 `docs/M3-COMPLETION-SUMMARY-2026-09-10.md` 指向 `qoker-repair-verification` 的路径。应修正文档链接；不能将 planning validator 通过与应用验收通过混为一谈。

### A09 · P2 · 写限流仅接入 move，补充算法修好不代表全接口覆盖

位置：`src/app/api/v1/tasks/[taskId]/move/route.ts:27`、`:53`；`src/server/modules/rate-limit/redis.ts:108`。

静态路由检查只有 move 调用该限流器，项目创建/修改及任务创建/修改/删除没有接入同一用户写额度。注释声称覆盖全部写操作，与实际调用关系不同。

补充算法实测已修好：60 次耗尽，过一分钟可再次连续请求。未接入的 Redis fallback 直接调用仍每次新建 MemoryRateLimiter：maxTokens=1 连续三次均放行并创建三个计时器；不能宣称此适配器可供生产使用。当前实际 move 使用独立内存实例，**该 fallback 缺陷不是当前 move 路由失效的证据**。

验收：按已有部署范围用共享的单实例写限流覆盖约定接口，验证用户隔离、超限 429 和 Retry-After。无需为通过 M3 临时增加 Redis/分布式架构；未完成的扩展应移除或明确保持不可用，不作为已交付能力。

### A10 · P2 · no-op 只修复了部分位置场景

位置：`src/server/modules/task/move.ts:234`、`:241`；`src/server/modules/task/position.ts:99`。

原案例 A/B/C 中把 B 放到 C 前，现在 version 和 boardVersion 不变，修复有效。但把已经在末尾的 C 再次追加到同列末尾，实测 version **1→2**、boardVersion **4→5**，任务顺序完全没变。

原因是以新算出的 position 是否相等识别 no-op，追加时仍先分配更大 position。验收应按实际顺序/邻接关系判断无操作，覆盖同列末尾、单卡列、相同前后邻居；无操作不改版本、不产生移动活动。

### A11 · P3 · 大写项目 UUID 的幂等重放仍 404

位置：`src/server/modules/task/replay.ts:14`；`src/server/http/json.ts:163`。

同一大写 projectId 路径、相同幂等键和请求体创建任务，第一次 **201**，第二次 **404 NOT_FOUND**。本轮改的是 Idempotency-Key 小写化和 move 的 taskId；没有解决 replay 中数据库规范 ID 与项目路径字符串严格比较的问题。

验收：统一在边界规范化资源 UUID，并用规范资源身份参与归属与幂等路由语义；覆盖大小写等价重放以及非成员、已删除资源不可通过重放读取的回归。

### A12 · P2 · 真实详情截止日仍用固定日期

位置：`src/features/tasks/task-detail.tsx:109`。

静态确认：详情调用 `getDueMeta(task.dueDate, "2026-09-09", status)`，没有沿用任务列表已实现的账户时区日期。日期变化后，同一任务在详情和列表可能获得不同的逾期/今天标签。补测日志中的 runtimeDate 是 UTC 日期，不用它宣称本轮已经完成账户时区边界实测。

验收：从统一账户时区日期来源传入 today；用跨午夜及不同时区测试验证列表、详情、看板一致。这是 M3 详情正确性，不要求提前实现 M5 我的工作台。

## 上轮 Q01—Q10 的复验结果

| 上轮项 | 本轮判断 | 证据 |
|---|---|---|
| Q01 真实详情/看板 | 未完成 | A02—A05、A12；真实详情 PATCH 400、看板 API 404 |
| Q02 no-op | 部分修复 | B before C 已修；同列尾项重复追加仍增版本，A10 |
| Q03 位置溢出 | 本次案例通过 | 接近 bigint 上限后追加 200；密集位置重编号 200，其他任务版本/时间不变 |
| Q04 分页 | 未修复 | 同任务 2 行且状态冲突，A06 |
| Q05 认证异常 | 本次案例通过 | 登录断网按钮恢复且提示错误；退出 503 留在设置页，会话仍存在，未假装成功跳转 |
| Q06 锁超时 | 未修复 | 55P03，约 5 秒返回 500，A07 |
| Q07 限流 | 部分修复 | 一分钟补充恢复；接口覆盖及未接入 fallback 仍有缺口，A09 |
| Q08 测试 | 有回退，未完成 | 同库保护被关闭；独立库下 6 项限流测试失败，A01/A08 |
| Q09 项目归属 | 本次案例通过 | 已加入的项目 B 路径访问项目 A 任务返回 404 |
| Q10 UUID 重放 | 未修复 | 201 后 404，A11 |

此前修好的核心移动契约、版本递增、统一活动、旧版本拒绝、并发一成功一冲突、归档拒写和严格日期输入，本轮均再次通过；无需推倒重做这些实现。

## M4 前的收尾顺序和完成条件

1. **先恢复可信检查环境**：A01/A08，保持开发库与测试库隔离，修复 lint、类型及测试失败；保存完整退出码和结果。
2. **完成真实编辑纵向流程**：A03/A04/A05/A06/A12，先做到列表→详情→保存→刷新正确，再补草稿/冲突/分页/时区和手机键盘行为。
3. **完成真实看板**：A02/A10，补规范 GET/分页/快照、正确移动请求、菜单替代、回滚及只读状态；不要直接接上目前未完成的 BoardViewClient。
4. **收尾已有后端边界**：A07/A09/A11，补实际驱动错误重试、写限流覆盖和 UUID 重放。继续沿用已通过的权限与事务保护。
5. **最终独立验收**：check、build、完整 integration、E2E、UI 全通过且零非预期跳过；新增 M3 用例覆盖真实双浏览器编辑冲突、拖拽成功/失败回滚、看板分页冲突、390px 与键盘闭环。每条结果对应真实页面/API，禁止以 fixture 回归代替。

达到这些条件后，将 ORB-010/011/012 与 M3 标为 done，再进入 **M4：邀请、成员加入退出/移除、活动及设置 UI（ORB-013—015）**。M5 评论附件、M6 部署求职材料和 M7 AI 不作为这次审查的缺失功能。

## 证据索引

- `artifacts/m4-gate-2026-09-10/observations.json`：真实 API、详情保存、看板、认证故障、锁、日期、UUID、分页。
- `artifacts/m4-gate-2026-09-10/detail-observations.json`：详情两次保存、草稿丢字符、伪完成/删除、列表导航。
- `artifacts/m4-gate-2026-09-10/move-boundaries/observations.json`：no-op、尾项重复移动、溢出、重编号、错误项目路径。
- `artifacts/m4-gate-2026-09-10/infrastructure.json`：两库迁移、约束、限流算法与独立 fallback 探针。
- 同目录 `check.log`、`typecheck.log`、`build.log`、`unit.log`、`contract.log`、`integration.log`、`e2e.log`、`ui.log`、`test-typecheck.log` 为本轮完整日志；PNG 为浏览器证据。

复验脚本的 exit 0 只表示脚本完成；各场景结果以 JSON 观察值为准，错误捕获不等于断言通过。没有进行生产部署、生产负载测量或 M4 验收。
