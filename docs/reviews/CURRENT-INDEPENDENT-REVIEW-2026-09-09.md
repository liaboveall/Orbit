# Orbit 当前版本独立审查 · 2026-09-09

审查者：Codex。对象：用户要求审查时的本地工作区，覆盖 M0—M3 已实现及声称完成的范围。当前无 Git 提交基线；以 `artifacts/current-review-2026-09-09/source-manifest.json` 的 215 个源文件/配置 SHA-256 固定本次对象。

**结论：M3 未达到完成条件，当前不能标记“生产就绪”。M1、M2 的正常主流程仍可运行，但存在需要补验修复的异常边界。** 此次发现 5 项 P1、5 项 P2、1 项 P3；另列测试与未接入代码的风险。P1 表示阻断当前里程碑验收或破坏关键写入保证，不等同于 CVSS 的 Critical。本轮没有发现并验证“未登录即可读取他人真实数据”的漏洞。

本轮只审查和纠正交接记录，没有修改应用源代码、依赖、迁移或测试，没有提交 Git、清库或推进 M4。真实请求使用唯一合成账户；直接 SQL 仅用于隔离数据、控制其行锁、核验与精确清理。浏览器验证使用开发服务器；生产构建失败，不能宣称生产运行验证通过。

## 1. 本次验证结果

以下是当前 M3 工作区的重新执行结果，不能与同日早先 M2 的绿灯混用。

| 检查 | 当前结果 | 说明 |
|---|---|---|
| `pnpm check` | 失败 | 停在 lint：15 errors、2 warnings；后续步骤未由此命令运行 |
| `pnpm typecheck` | 失败 | rate-limit/index.ts 语法错误；尚不能排除其后被遮蔽的类型问题 |
| `pnpm build` | 失败 | 打包编译阶段输出不等于整体通过；类型检查退出失败 |
| `pnpm test:unit` | 114 passed / 12 failed | 2 个文件失败：日期预期 1 项、草稿环境 11 项 |
| `pnpm test:contract` | 135 passed / 1 failed | contracts/dto.ts 跨层引入 lib/calendar，违反现有边界门禁 |
| `pnpm test:integration` | 152 passed / 1 skipped，另 1 suite 收集失败 | rate-limit 测试导入 Prisma 时环境未加载；move 测试 describe.skip |
| `pnpm test:e2e` | 8 passed / 0 skipped | 现有 M1/M2 主流程；没有真实 M3 移动闭环 |
| `pnpm test:ui` | 12 passed / 1 failed | 旧 fixture 独立详情用例未适配真实详情路由；不应直接当作焦点机制回归 |
| 数据库迁移核验 | 开发库 5，测试库 4 | 两库已应用迁移 checksum 均匹配；测试库缺 MoveRecord 迁移 |
| 数据库 CHECK | 两库 7 条存在 | 基础约束仍在，不代表移动版本、权限和排序语义已被约束覆盖 |
| `pnpm audit --prod --json` | 2 high / 1 moderate | 首次因 CA 校验失败；只为该命令启用系统 CA 后取得结果，未关闭 TLS 验证 |

证据目录：`artifacts/current-review-2026-09-09/`。包括各命令日志、`observations.json`、`infrastructure.json`、`ui-supplement/observations.json`、截图和复现脚本。第一次详情/退出探针遇到定位问题，结果明确保留为 probeFailure；调整定位后的补充脚本才是这两项结论的依据。

## 2. 已确认问题，按修复优先级排列

### R1 · P1 · 当前代码无法通过构建门禁

位置：`src/server/modules/rate-limit/index.ts:64,143`；`src/features/board/board-view-client.tsx:50`；`src/features/shell/state-switcher.tsx:43`。

- 类型中的 `checkLimit(userId: string; key?: string)` 用分号分隔函数参数，造成 TS 语法错误，直接阻断 typecheck/build。
- 看板在 useMemo 回调内调用 useSensors/useSensor，违反 Hook 调用规则；还有 `undefined as any` 绕过契约类型。
- StateSwitcher 在部分 Hook 前按环境提前 return，触发 Hooks 门禁。
- 当前 `pnpm build` 的最终退出码为 1。“编译成功 1129ms”“0 errors”“构建门禁绿灯”不能作为当前状态。

修复验收：完整 `pnpm check`、`pnpm build` 均 exit 0；不得通过关闭规则、忽略错误或删除检查达成。

### R2 · P1 · 移动接口返回 500，但业务事务已提交；请求/响应契约也分叉

位置：`src/server/modules/task/move.ts:40,189`；`src/app/api/v1/tasks/[taskId]/move/route.ts:2,103`；对照 `src/contracts/dto.ts:291`。

实测：

1. 按文档提交 `{expectedVersion, expectedBoardVersion, toStatus, beforeTaskId}`，接口返回 400，要求另一字段 newStatus。
2. 按新服务私有格式 `{newStatus:"IN_PROGRESS",expectedBoardVersion:...}` 提交，接口返回 500 INTERNAL_ERROR。
3. GET 与直接查库都确认任务已变成 IN_PROGRESS，MoveRecord 已增加一条。

原因：路由使用服务层另造的 MoveTaskSchema。结果把 bigint position 混入 JSON；事务先提交，随后响应序列化失败。服务返回 `{task,meta:{currentBoardVersion}}`，也不符合约定的 `{task,boardVersion}`。

影响：用户看到失败后重试，可能产生额外移动记录和看板版本递增，无法依据响应判断操作是否发生。

修复验收：复用 contracts 请求/结果 schema；不暴露 position；合法契约请求返回可解析的 200；无效请求 400 且不写库；正常响应和数据库状态一致。

### R3 · P1 · 移动绕过任务版本、看板并发锁及统一活动记录

位置：`src/server/modules/task/move.ts:113–181`。

实测：

- 移动后 Task.version 仍为 1；再用移动前 expectedVersion=1 PATCH 回 TODO，返回 200，旧客户端能覆盖刚发生的移动。
- 对同项目两个不同任务，用相同 expectedBoardVersion=7 并发移动。通过持有本次合成项目行锁，让两个请求都在提交前完成版本读取，再释放锁：两个任务都被写入，boardVersion 从 7 变成 9；两个目标 position 都是 1024。
- ActivityLog 只有 TASK_CREATED；移动只写新建的 MoveRecord，没有进入约定的统一活动历史。

原因：鉴权、boardVersion 读取和 position 计算均在写事务外；更新任务不检查 expectedVersion，也不递增 version；没有沿用 Project→Task 锁顺序。expectedBoardVersion 还是可选字段。同列算法也没有复用完整的间隙耗尽重编号策略。

修复验收：在共同项目锁保护的事务内重查权限/归档/删除/版本、分配位置、更新 task.version 与 boardVersion、写 ActivityLog；同一旧快照的并发请求只能一个成功，其余 409；加入与普通 PATCH、删除、归档竞争的真实数据库测试。

### R4 · P1 · 归档项目仍能通过移动接口修改任务

位置：`src/server/modules/task/move.ts:113–122`。

实测：把本次合成项目归档后，提交 `{newStatus:"DONE"}`。虽然由于 R2 返回 500，数据库任务确实变成 DONE。接口只有成员检查，没有读取或拒绝 archivedAt，也没有要求任务 expectedVersion。

影响：违反归档只读规则。普通 PATCH 的归档保护不能覆盖另一个写入口。

修复验收：归档项目的所有移动请求返回 409 PROJECT_ARCHIVED；任务、版本、排序和活动记录均无变化；归档与移动并发时也保持此规则。

### R5 · P1 · M3 的看板、详情编辑和列表交互尚未形成真实闭环

位置：`src/app/app/projects/[id]/board/page.tsx:31`；`src/features/tasks/real/task-detail-client.tsx:29`；`src/features/tasks/task-detail.tsx:205`；`src/app/app/projects/[id]/tasks/page.tsx`。

浏览器实测：

- 新建真实任务后打开其真实项目看板，页面标题仍是“看板 · Orbit（M0 样例）”，展示 CAMP 等 fixture 任务，没有本次真实任务。
- 真实独立详情能够读取服务器任务，但修改标题点“保存”，写请求数为 0，GET 的标题不变；出现“样例模式：未连接真实后端”提示。
- 新写的 BoardViewClient、useProjectTasks/useBoardTasks/useTaskEdit 等在 src 中没有实际页面调用。新增文件不等于已接入用户流程。
- 列表 page 仍只传固定 limit 给服务，没有消费 searchParams；M3 要求的筛选 URL、真实详情侧面板、真实看板同快照分页、1000 任务分页和拖拽闭环没有完成。

截图：`ui-supplement/detail-save.png`、`ui-supplement/board-route.png`。

修复验收：按 docs/06 的 ORB-010/011/012 逐条串起真实页面；从列表/看板打开详情、编辑、保存、关闭、刷新都保留正确数据与上下文；实际移动请求持久化且失败可恢复；键盘/390px 也能完成。子任务、附件、评论的真实功能仍属 M5，不作为本项缺失内容。

### R6 · P2 · “加载更多”的旧响应能污染刷新后的列表

位置：`src/features/tasks/real/task-list-client.tsx:88,118`。

实测：用 51 条合成任务，暂缓第二页响应；把该页的一条任务更新到第一页，再通过页面行内修改触发 RSC 刷新；最后放行原第二页响应。同一任务出现两行，一行“进行中”、一行“待办”，React 同时报告重复 key。

原因：props 更新只清理已加载 extraTasks，没有取消或判定仍在途请求所属的数据批次，旧响应随后仍被追加。新增 TanStack Query 的 queryKey 函数没有接入当前组件，因此没有修复这里。

修复验收：刷新、切换项目或筛选后丢弃旧批次响应；用上述延迟响应顺序断言无重复任务、无旧版本。相同模式的项目列表也需一起检查。

### R7 · P2 · 认证请求失败后页面无法正确恢复

位置：`src/features/auth/use-auth.ts:64,113`；`src/features/shell/user-menu.tsx:55–65`。

实测：

- 中断登录 fetch 后触发 Failed to fetch，按钮一直“登录中…”且禁用，无可见错误与重试机会。多个认证 hook 都在 await 后才清 pending，没有异常兜底。
- 将退出接口模拟为 503，使用键盘执行菜单退出后，页面硬跳登录又被重定向至 /app/today，`GET /api/v1/me` 仍为 200，页面无退出失败提示。

退出 hook 未检查 Better Auth 返回的 error；菜单又无论成功失败都跳转。此处没有发现服务端会话撤销机制失效，而是客户端把请求失败当作完成处理。

修复验收：认证操作以 finally 恢复交互，区分网络/服务器错误与密码错误；退出失败明确提示并保留重试入口，不能声称已退出；注册、重置、重发验证邮件覆盖相同边界。

### R8 · P2 · 数据库锁等待仍返回 500，承诺的技术重试没有生效

位置：`src/server/db/tx.ts:59–69,111`。

实测：独立连接持有本次合成 Project 行锁，再创建任务；约 5044ms 后返回 500 INTERNAL_ERROR，释放锁后清理本次数据。不是重试预算耗尽后的 409。

当前代码只遍历 code/originalCode 与直接 cause 链，没有全面覆盖 Prisma/driver adapter 包装错误中的 meta；修改 lock_timeout 从 3 秒到 5 秒只改变等锁时间，不能证明错误映射被修复。具体错误结构应加入回归固定，不能只用手造 code 对象证明重试。

修复验收：真实持锁测试验证超时的有界重试及最终 409；途中释放锁时可成功；业务 VERSION_CONFLICT 不被无条件技术重试；事务总时长可解释。

### R9 · P2 · 新日期范围校验放行不存在的日期，输入错误变成 500

位置：`src/contracts/dto.ts:256,269`；`src/lib/calendar.ts:18–25`；`src/server/modules/task/date-only.ts`。

实测：dueDate=`2026-02-30` 创建任务返回 500；同日早先 M2 检查对此输入返回 400。当前范围校验使用 new Date，JavaScript 会将该值归一化为三月日期，范围检查通过；服务层随后发现不存在的日历日并抛 RangeError。

0001/0099 年现在确实返回 400，不能再将其记录为当前缺陷；但解决年份范围时丢失了严格的 YYYY-MM-DD/真实日历日约束。新增 1900—2100 范围也需明确写入契约与产品决策。

修复验收：先验证严格 date-only 与真实日历日，再应用已确定的年份限制；无效日期、带时分秒字符串等统一 400，不应进入业务事务或触发 500。

### R10 · P2 · 限流补充速度错误，且当前并没有覆盖全部业务写入

位置：`src/server/modules/rate-limit/memory.ts:71–75`；`src/server/modules/rate-limit/redis.ts:108`；move/route.ts。

实测隔离限流器：配置 60 次/60000ms，耗尽 60 次后将测试时钟推进一分钟，只允许 1 次，第二次即拒绝。当前代码每分钟仅补 1 token，持续使用时远低于“每分钟 60 次”的意图。

代码搜索显示业务限流仅在 move 路由接入；其它项目/任务写入口没有接入该限制。move 的 429 错误码写成 RATE_LIMIT_EXCEEDED，与契约 RATE_LIMITED 不一致。

另对声称生产 fallback 的 Redis 骨架进行隔离验证：maxTokens=1 时连续 3 次全部允许，每次新建 MemoryRateLimiter 并建立新的清理 timer。**该 Redis 路径目前没有接入 move 请求，不能把此隔离结果写成当前线上可利用漏洞**；但它不能作为“生产级分布式限流已交付”的证据。项目原规划不要求新增 Redis，应优先遵循已确定的单实例范围。

修复验收：统一每用户写限流入口和契约错误码；用可控时钟验证耗尽与恢复；同一实现复用同一 bucket；未实现的 Redis 路径标明不可用或移除范围外骨架，不增加虚假生产承诺。

### R11 · P3 · 大写 UUID 路径使幂等重放错误返回 404

位置：`src/server/modules/task/replay.ts:13–15`。

实测：用大写项目 UUID 路径创建任务返回 201，相同路径、key、body 重试却返回 404。数据库 UUID 已归一化，代码又以区分大小写的字符串与入参比较。当前没有重复创建，但幂等成功重放不能工作。

修复验收：边界统一 UUID 规范化，或按 UUID 语义比较；在保持软删除与权限重验的前提下，大小写路径均可正确重放。

## 3. 测试与未接入代码需要一起收尾

这些检查解释了“文件都写了、部分测试通过”为什么不能证明 M3 完成。

- **移动测试未执行。** `tests/integration/move-task.test.ts` 只有 describe.skip 的占位；其余完整示例在注释中。数据库其实可用，开发库已经有 MoveRecord，但测试库缺新迁移。152 项通过都是此前范围，不能覆盖新移动语义。
- **集成测试前置不统一。** rate-limit.test.ts 在 env 初始化前静态导入 Prisma，suite 收集就失败。应统一安全的独立测试库初始化，不能为让测试运行而指向开发库。
- **日期测试依赖当天。** 新 calendar.test.ts 用固定 2026-09-09 断言真实当前时间；未来自然失效。原 dateInTimezone 的 now 参数现在被忽略，也失去固定时刻测试能力。
- **草稿测试环境不完整。** 11 项在 beforeEach 因 window/localStorage 不存在而失败。“mock 已修复”与结果不符。
- **契约门禁有实际失败，也有盲区。** dto.ts 引入纯前端可用 calendar 不等同于服务端凭证泄露，但违反当前只允许同层依赖规则，必须合理调整结构或明确修正规则；不能跳过。openapi-consistency 的 36 operations 比较的是手写预期列表与 spec，不遍历真实路由，不能表述为“36 个接口实现一致”。
- **旧 UI 用例要迁移。** 当前失败那项仍用 fixture 的项目/任务 ID 打开真实详情，找不到预期按钮。应迁移到合成真实任务，并保留键盘焦点/关闭上下文断言；不能直接删除。
- **未接入查询 hooks 存在多处确定的契约不匹配。** 三个查询 hook 传入带 `/api/v1` 的 path，API client 默认还会加同样前缀；任务列表用 TaskSchema 解析 TaskSummary；getNextPageParam 返回字符串 `next` 而非 meta.nextCursor；queryKey 未包含当前用户，列表 key 也漏 q。它们目前没有页面调用，因此列为接入前必修，不冒充已观察到的用户数据泄漏。
- **未接入编辑/冲突工具仍是骨架。** useTaskEdit 调不存在的 POST /tasks/:id/edit，契约是 PATCH /tasks/:id；传 undefined 代替响应 schema；缓存 key 与详情 hook 不一致。handleVersionConflict 读取 result.code，真实错误在 result.error.code；合并辅助函数直接抛 Not implemented。仅接上 UI 不足以完成 ORB-012。
- **新拖拽组件也不能直接上线。** 仍有 Hook 违规；将 over.id 一概作为状态，但卡片目标是 task UUID；使用 task.version 作为 expectedBoardVersion，newPosition=null 又与服务 schema 冲突；缺少已完成的键盘替代和真实失败反馈。当前页面未引用该组件。
- **独立详情的项目归属注释超出实现。** 页面分别读取可见 Project A 与可见 Task B，没有断言 task.projectId===路由 projectId。普通未授权任务仍由 findTaskDetail 拒绝；需补两个可访问项目互换路径的测试，避免串上下文，不能据此声称跨权限读取已成立。
- **文档证据失真。** PROGRESS/backlog 中“全部修复、无阻断、生产就绪”与当前结果相反；README 仍写 M2 完成且看板/详情为 fixture。交接必须只保留一份当前结论，旧说明标明历史。

## 4. 没有作为当前缺陷的部分

- 认证正常链路、设置、真实项目/任务创建、连续状态修改、软删除/恢复及账户时区主流程通过当前 8 项 E2E；原 M2 慢刷新 pending、恢复响应丢失重试等既有回归仍在通过。
- 数据库基本约束及已应用迁移 checksum 正常，应用并非需要全部推倒重来。
- 现有视觉框架已形成较一致的蓝紫品牌色、留白、卡片与表单层次。当前更迫切的是让真实导航和操作闭环，避免真实内容与样例入口混用。此次没有进行完整视觉性能/Lighthouse/生产压力认证，不能给出未测的性能分数。
- 成员邀请/退出/活动完整页面属 M4；子任务、评论、私有附件、真实工作台统计属 M5；部署/CI/求职材料属 M6；AI 属可选 M7。未实现这些不等于当前里程碑缺陷。
- 依赖审计出现 [deepmerge-ts 公告](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) 和 mysql2 的 [认证公告](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr)、[压缩协议公告](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3)。当前是 PostgreSQL，未发现 MySQL 连接路径；循环对象递归问题也不能直接等同于普通 JSON 请求可利用。应追踪上游兼容升级，但扫描等级不代表本项目已经具有同等级可利用漏洞。

## 5. 建议下一轮开发顺序与完成标准

1. 恢复编译与测试环境：解决 R1，统一独立测试库迁移与测试前置，修复失败测试的根因和过时用例。
2. 完成移动领域服务：合并 R2/R3/R4 为同一条契约、授权、锁、版本、活动与响应都闭合的实现；先真实数据库验证，再连接拖拽。
3. 真正完成 ORB-010/011/012：列表筛选、真实看板/分页、详情侧面板/独立页编辑与冲突草稿保护；不要留下两套不一致的请求与缓存实现。
4. 收尾 R6—R11：延迟分页、认证网络失败、锁超时、输入校验、业务限流与幂等边界。
5. 重跑全部检查，加真实 M3 E2E、双浏览器冲突、归档竞争、1000 任务分页及 390px/键盘验收。只在命令退出成功、关键异常场景有证据后将 M3 改回 done。

当前推荐动作是修复与补验 M0—M3 已有范围；不进入 M4，不重建整个项目，不以增加更多工具或组件代替完成当前流程。
