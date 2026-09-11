# 专家分工与集成顺序

目标是补齐当前 M0—M3，而非新增 M4 功能。以下为逻辑角色；按实际并发容量分批执行，角色数量不代表必须同时启动同等数量进程。

## 统筹负责人

负责读取全部审查结论，建立任务依赖、文件所有权与验收记录；只由统筹修改共享规格、契约、全局配置及最终状态。其他专家提出修改请求，由统筹串行合入。

独占：`contracts/openapi.json`、`src/contracts/**`、`package.json`、锁文件、`docs/01—11`、`PROGRESS.md`、`planning/backlog.json`、README，以及跨专家共享的 AppProviders/全局路由决策。数据库迁移必须由统筹确认唯一负责人，不能多个专家各生成一套。

开始前冻结三项决策：

1. 沿用现有 Server props + createApiClient + router.refresh 完成 M3；如果发现客观不足，先提出明确替代并同步 ADR。不得重新接回已删除的错误 hooks。
2. 移动请求/响应与看板读取均复用既有契约；不要各自另造字段。
3. 对 no-op、插首允许负数、bigint 边界、1900—2100 日期范围，统一规格与实现。不能为了让测试通过删掉产品需要的保证。

## A · 后端与数据一致性专家

任务：Q02、Q03、Q06、Q07、Q10；为 Q01 完成 board GET 与可靠分页。

独占代码：`src/server/db/tx.ts`、`src/server/modules/task/**`、`src/server/modules/rate-limit/**`、必要的 idempotency/项目服务，以及 `src/app/api/v1/**` 中相关业务路由。维护对应领域集成测试；不要修改认证 UI、业务页面、全局契约或测试框架配置。

重点：

- 保留已通过的移动权限/归档/版本/活动事务，定向补 no-op 和排序溢出。
- board 读取在短 REPEATABLE READ 事务获取版本、总数与列数据，游标绑定项目/列/筛选/快照。
- 普通任务分页与看板分页是不同语义，不能把 updated_desc 列表直接当排序看板。
- 真实锁超时解析与有界技术重试；所有业务写统一限流，沿既定部署范围实现，不引入 Redis 服务。
- UUID 规范化不能绕过删除、归档、成员关系和幂等内容冲突检查。

给前端的交付物：固定端点/schema、真实请求示例、错误码与版本字段、测试证据；不能只写“API 完成”。

## B · 前端与交互专家

任务：Q01、Q04、Q09；在真实业务页面完成 ORB-010/011/012。

独占：`src/features/board/**`、`src/features/tasks/**`、业务项目列表 UI、`src/app/app/projects/**`、任务草稿纯工具。`app-shell.tsx` 的导航修改先向统筹预约；不编辑认证 use-auth/user-menu、后端服务或共享契约。

重点：

- 业务看板调用真实服务；样例只留在样例路由，真实任务详情不得继续复用无写入能力的保存处理。
- 修正 BoardViewClient 的旧请求字段、错误响应 schema、task.version 冒充 boardVersion、拖到卡片时误认状态等问题，再接入。
- 筛选写入 URL；详情侧面板关闭返回原筛选/滚动/焦点；直接链接仍独立可用。
- 页面刷新取消或忽略旧批次分页响应，防止旧数据/旧游标追加。
- 任务读与路由项目必须一致，错误组合 404；与后端专家商定可复用归属校验函数，但服务文件只由 A 写。
- 明确保存、失败保留草稿、409 展示最新值并保留本地输入；按用户/项目/任务隔离本地草稿。
- 有键盘移动替代；筛选或列数据未完整时按规格限制拖拽；加载、空、错误、只读和手机状态完整。

## C · 认证与失败恢复专家

任务：Q05。

独占：`src/features/auth/**`、`src/features/shell/user-menu.tsx`、认证单元/浏览器回归。认证服务若确需修改，先向统筹声明；不要更换 Better Auth 或自行改 Cookie 策略。

重点：await 抛异常时 finally 解除 pending；区分网络/服务失败与凭据错误；退出检查返回 error，失败不走成功导航。覆盖登录、注册、找回/重设、重发验证、退出的共同失败模式，保持原有会话隔离与 returnTo。

## D · 测试环境与独立验收专家

任务：先修 Q08，再独立验收所有工作包。

独占：`tests/integration/rate-limit.test.ts` 的环境/隔离重构、公共测试 setup、需要统筹授权的 vitest 配置、`tests/e2e/m3-*.spec.ts`、M3 UI/回归证据与复验报告。A/C 自己的领域回归文件由其维护，D 审查而不同时改写。

重点：

- 在任何 Prisma import/写入前强制独立测试库；不要只加载 dotenv 就运行原限流测试。
- 限流纯算法不必访问 DB；需要数据库的测试按唯一 runId 精确清理，禁止 contains 前缀批量删除。
- 为每个 Q 项补可失败的断言；审核成功路径和异常路径，不能让被测代码作者仅凭自报结果验收。
- 真实 1000 任务、两个浏览器并发、延迟/中断响应、键盘和390px；不把样例截图当真实业务证据。
- 不以 snapshot 数量、测试个数或 build 一项通过替代完成定义。

## 顺序与依赖

| 阶段 | 工作 | 退出条件 |
|---|---|---|
| 0 基线 | 统筹冻结契约/文件所有权；D 修测试隔离；A/B/C 阅读对应代码 | 不覆盖已有改动；测试库可安全使用；所有角色理解已修复项 |
| 1 可并行 | A 后端边界与board；B 列表/详情独立交互；C 认证失败；D 编写验收场景 | 各自相关检查通过，交付真实接口/页面而非骨架 |
| 2 串联 | A+D 验证 board API；B 接入看板/拖拽/分页；统筹同步共享文档 | 真实 M3 纵向闭环，无双份契约或缓存真源 |
| 3 独立验收 | D 执行验收清单；有失败退回对应负责人；统筹复核 | 全部门禁 exit 0，关键场景通过，未完成项如实保留 |
| 4 交接 | 统筹更新状态与报告 | Q 项逐项有证据；M3 完成条件全部满足才 done；不进入 M4 |

## 共享契约速查

```text
POST /api/v1/tasks/{taskId}/move
body = { expectedVersion, expectedBoardVersion, toStatus, beforeTaskId }
data = { task: TaskDTO, boardVersion }
外层 = { data, meta: { requestId } }

GET /api/v1/projects/{projectId}/board
query = limit, cursor, status, q, priority, assigneeId, unassigned, overdue
有 cursor 时 status 必填；具体以 openapi 和 docs/05 为准。
data = { boardVersion, columns: [{ status, total, items: TaskSummaryDTO[], nextCursor }] }

PATCH /api/v1/tasks/{taskId}
body = { expectedVersion, ...允许修改的字段 }
无 POST /tasks/{id}/edit 端点。

createApiClient 默认前缀 /api/v1；传入 path 不重复该前缀。
api.post(path, responseSchema, body)：第二参数是响应数据 schema。
```

并行纪律：同文件唯一写入者；变更共享接口先由统筹合入；不跨 shell 删除/移动目录；不改 .env、清库、reset、force push、自动提交。长时间工作可以分阶段交接，但没有证据的任务不得改为 done。
