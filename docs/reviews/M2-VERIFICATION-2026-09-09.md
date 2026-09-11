# M2 验证记录（2026-09-09）

> 后续独立复核发现的 4 项问题现已修复复验，当前 M2 为 done。最新证据请以 [M2 独立复核](M2-INDEPENDENT-REVIEW-2026-09-09.md) 为准；下文保留为实现阶段历史验证记录。

**结论：M2 项目与任务纵向闭环验收通过。** M2 与 ORB-007 / ORB-008 / ORB-009 为 done，applicationStatus 置为 `M2_PROJECT_TASK_COMPLETE`。CodeReview 三维审查（完整性/正确性/影响）发现的 HIGH/MEDIUM 问题已全部修复并回归；Browser 交互式验证发现的阻塞级前端 props→state 同步缺陷亦已修复并补回归 E2E（见下文「Browser 交互式验证与前端缺陷修复」一节），无遗留阻断项。

## 验证范围

- ORB-007：项目域四表迁移（Project/ProjectMember/ActivityLog/IdempotencyRecord）、授权服务、幂等服务、活动写入器、游标分页、项目 CRUD 5 端点。
- ORB-008：Task 表迁移、position/identifier/date-only、任务服务（create/read/update/soft-delete/restore）、任务 6 端点。
- ORB-009：种子数据、契约信封测试、活动测试、E2E 纵向闭环。
- 前端：/app/projects 列表+创建表单、/app/projects/[id]/tasks 任务列表+行内交互、/app/projects/[id]/trash 回收站、app-shell 两处最小改动。
- 本报告为收尾验证汇总；不含 M3 范围（任务详情/看板真实数据化、TanStack Query、业务写限流）。

环境：Windows，Node v26.8.1，pnpm 10.34.5，Next.js 16.3.4，Prisma 7 + PostgreSQL 17.11（本地 5433，orbit_dev / orbit_test 隔离），SMTP 指向本地 Mailpit。

## 最终测试数字（2026-09-09 实际执行）

| 实际命令 | 结果 |
|---|---|
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | 全部 exit 0 |
| `pnpm check` | exit 0：unit **89** + contract **136**（9 文件） |
| `pnpm test:integration` | **148 passed**（11 文件，独立库 orbit_test；含 concurrency-invariants 4 + permission 3 + activity 11 + idempotency 3 + project/task/project-concurrency） |
| `pnpm test:ui` | **13/13** |
| `pnpm test:e2e` | **7 passed**（smoke 1 + auth 4 + m2-vertical 1 + m2-no-reload 1；前端缺陷修复前为 6/6，修复后新增不 reload 回归用例增至 7） |
| `pnpm db:seed` | 成功（用户 1 + 项目 2 + 任务 9 + 活动 13，写入 orbit_dev） |
| `python planning/validate_plan.py` | PASS |

E2E 纵向闭环（tests/e2e/m2-vertical.spec.ts）：登录 → 创建项目 → 创建任务 → 编辑状态 → reload 持久化 → 软删除 → 回收站恢复。

## 三道硬门禁

| 门禁 | 结果 |
|---|---|
| openapi-consistency（tests/contract/openapi-consistency.test.ts） | 36 operations method+path 与实现逐项一致 ✓；11 个 M2 业务端点（listProjects/createProject/getProject/updateProject/listMembers/listProjectTasks/createTask/getTask/updateTask/deleteTask/restoreTask） |
| boundary server-only（tests/contract/boundary.test.ts） | src/contracts 零服务端导入、src/server 全文件 server-only 保护 ✓ |
| m0-review（tests/ui/m0-review.spec.ts） | 13 项 M0 UI 回归在真实会话下保持通过 ✓ |

## 迁移核实结论

- `20260909001003_add_project_domain`：Project/ProjectMember/ActivityLog/IdempotencyRecord 四表，对 User.id 全 ON DELETE RESTRICT（ADR-023）。
- `20260909004718_add_task_domain`：Task 表。
- 两迁移合计 **7 条 CHECK 约束已确认落库**（直查 orbit_dev information_schema 核对）；`prisma migrate status` 无 checksum 漂移，orbit_dev / orbit_test schema up to date。

并发不变量实证（tests/integration/concurrency-invariants.test.ts，真实数据库）：编号 20 并发唯一、资源 version 冲突一成功一 409、同幂等键并发仅一行、项目 key 并发唯一。

## CodeReview 三维发现与修复对照表

| # | 发现 | 修复 | 回归 |
|---|---|---|---|
| 1 | 项目 DTO openTaskCount 为常量，不反映真实任务数 | 改真实计数查询 | project 集成测试 |
| 2 | restoreTask 未锁 User 行，与注销/并发操作存在竞争 | restore 增加 User 锁 | task 集成测试 |
| 3 | 非法格式 projectId 触发数据库层错误而非业务 404 | 入口格式校验 → 统一 404 | permission 集成测试 |
| 4 | 错误码提取只覆盖部分层，包装异常丢失 pg 错误码 | pgErrorCode 全链扫描（cause 链） | 单元 + 集成测试 |
| 5 | 55P03（lock not available）被归为 500 | 识别为可重试冲突 → 409 | concurrency-invariants |
| 6 | 幂等记录 commit 阶段的唯一冲突未兜底（aborted 事务内二次失败） | 冲突哨兵：commit 冲突转按已存记录重放 | idempotency 集成测试 |
| 7 | 游标分页接受任意 cursor 值，畸形值致 500 | 游标值校验 → 400 VALIDATION_ERROR | project/task 集成测试 |
| 8 | readJsonBody 先整体读入再判长度，可被大 body 耗尽内存 | 流式读取 + 边读边限长（超限即 413） | contract 测试 |
| 9 | restoreTask 幂等重放顺序错误，重放可能返回非缓存结果 | 先查幂等缓存并重新授权，再执行业务 | idempotency + permission |
| 10 | 任务列表搜索 ILIKE 未转义 `%`/`_`/`\`，可构造全匹配 | ILIKE 特殊字符转义 | task 集成测试 |
| 11 | 先取行锁后授权，非成员请求也能触发锁竞争 | 锁前置授权预检 | permission 集成测试 |
| 12 | 前端重试时重新生成幂等键，失去重放语义 | 客户端幂等键在同一操作重试间保留 | e2e + ui |
| 13 | vitest 集成测试文件级并行导致 orbit_test 数据竞争 | 关闭 fileParallelism | test:integration 全量重跑 |
| 14 | e2e 合成数据残留开发库 | m2-vertical afterAll 清理 | test:e2e |
| 15 | SMTP 端口文档与实际配置不一致 | docs/08 文档同步 | 文档核对 |

## Browser 交互式验证与前端缺陷修复（Task #33，2026-09-09 补记）

### 双重浏览器验证方法

门禁全绿（lint/typecheck/build/check/integration/ui/e2e 6）后，M2 另经两轮独立浏览器交互验证：

- **Emily：a11y snapshot 交互式验证**——以可访问性树为视图逐步操作真实页面（创建项目/任务、行内改状态、删除、恢复），验证交互反馈与状态同步。
- **Jay：headless Playwright 全流程截图**——注册→验证→登录→项目空态→创建项目→任务空态→创建任务→改状态→reload 持久化→软删除→回收站→恢复 12 步全 PASS，截图证据存于 **artifacts/m2-browser/**（12 张 + summary.json，pageErrors 为空）。

两轮验证交叉确认了同一个阻塞级前端缺陷。

### 发现的缺陷：列表客户端 useState 镜像 props

- 现象（单用户、无并发）：创建项目后同页仍显示「还没有项目」；创建任务后行不出现；行内状态 Select 选「已完成」后仍显示旧值；紧接着的第二次 PATCH/DELETE 带陈旧 expectedVersion → **假 409 VERSION_CONFLICT**，弹「任务已被其他人更新」，必须手动刷新页面才能继续操作。
- 根因：`src/features/projects/project-list-client.tsx` 与 `src/features/tasks/real/task-list-client.tsx` 用 `useState(initialProps)` 镜像 Server Component 首屏 props，写操作成功后仅调 `router.refresh()`；组件不重挂载 → useState 不会以新 props 重新初始化，列表与 task.version 永远停在旧数据。refresh 机制本身正常（对照：纯 Server Component 的回收站页 refresh 后立即更新）。
- 为何门禁漏检：`tests/e2e/m2-vertical.spec.ts` 每步写操作后 `page.reload()` 验证持久化，恰好绕过「同页不 reload 连续写」的真实交互路径；typecheck/单测/集成测试均无法触及此类 RSC 数据流缺陷。

### 修复方式

- **props 作为唯一数据真源**：列表直接渲染 Server Component 传入的 props，不再镜像进 useState；「加载更多」分页追加片段单独维护 state，并在 props 变化时重同步。
- 子组件（状态 Select、删除/恢复按钮）从 props 读最新 version，写操作 `await router.refresh()` 后再恢复交互，保证 expectedVersion 始终新鲜。

### 新增回归用例

- **tests/e2e/m2-no-reload.spec.ts**：全程不 reload 的连续写用例（创建项目→创建任务→连续两次改状态→删除→回收站恢复），每步断言同页 UI 立即更新；**核心断言：连续两次 PATCH 均返回 200 而非假 409**（若 version 镜像缺陷复发，第二次必 409）。afterAll 直连 PostgreSQL 按本轮唯一 email 精确清理，不污染开发库。

### 修复后全量门禁

- `pnpm test:e2e` 由 6 增至 **7 passed**（smoke 1 + auth 4 + m2-vertical 1 + m2-no-reload 1）；其余门禁（check：unit 89 + contract 136、integration 148、ui 13、三道硬门禁）保持不变全绿。
- 教训沉淀：纵向闭环 E2E 需同时覆盖「reload 持久化」与「不 reload 同页更新」两条路径；M3 引入 TanStack Query 时数据真源仍应为服务端 props/query，不得重新引入客户端镜像 state。

## 已知限制

- TanStack Query 推迟 M3（当前 createApiClient + router.refresh，ADR-017）；前端列表 props→state 同步缺陷已于 Task #33 修复（见上文），m2-no-reload 作回归护栏。
- Task 子资源计数（subtask/comment/attachment）M2 返回常量 0，M5 建表后改真实计数（ADR-018）。
- 业务写限流（60 次/用户/分钟）推迟 M3。
- 任务详情/看板独立页保持 fixture 至 M3；M2 真实编辑在任务列表页行内交互（ADR-022）。
- MAX_PROJECT_MEMBERS=20 配额在 M4 成员端点才生效（M2 仅 listMembers 只读端点）。
- 本报告不覆盖：生产部署验证、真实多用户长时间并发压测、完整无障碍审计（属 M6 / ORB-020）。

## 状态与下一步

- backlog：M2 done，ORB-007/008/009 done（evidence 已回写，含 Task #33 前端修复记录），applicationStatus = M2_PROJECT_TASK_COMPLETE。
- 下一步唯一推荐任务：M3 / ORB-010（任务列表与详情导航），开工前先引入 TanStack Query 并落地业务写限流。
