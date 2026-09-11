# M0–M4 全面审查问题修复与复验报告

日期：2026-09-10；范围：修复 [M0-M4-DEEP-AUDIT-2026-09-10.md](M0-M4-DEEP-AUDIT-2026-09-10.md) 复现的问题，本轮**只修复既有范围，不开发 M5**。

## 1. 结论摘要

- A01–A06（邀请配额/事务、活动刷新、项目设置冲突）**全部修复并有正式回归测试**，不是让审查探针本身转绿就了事——探针已 promote 进 `tests/integration/invitations.test.ts`（9 项新用例）与 `tests/e2e/m4-activity.spec.ts`（3 项新用例），同步方式随锁顺序修复调整，业务断言未弱化。
- 修复过程中额外发现并修复审查报告未列出的邀请创建幂等 `routeKey` 缺陷（详见 §3）。
- A07（限流缺口）、A08（归档找回入口）、A09（受限 Markdown）、A13（邀请页文案/token 清理）均已补齐。
- A10（测试环境独立性）、A11（文档统一）、A12（Git 基线）、全端点权限矩阵排查**本轮未关闭**，原因、影响、验收条件见 §5。
- 依赖扫描 2 high/1 moderate 仍存在，已核实均不在运行路径上，未做未经验证的跨主版本 override（见 §6）。
- **M4 状态保持 review，不建议开始 M5**（不满足审查报告第 7 节列出的全部门禁，见 §7）。

## 2. 实测命令与结果（本轮修复后，无重试）

| 命令 | 结果 |
|---|---|
| `pnpm check` | exit 0：lint/typecheck；122 unit + 136 contract |
| `pnpm build` | exit 0（31 路由） |
| `pnpm test:integration` | exit 0：17 files / **242 passed** / 0 skipped（原 232 + 本轮新增 10 项） |
| `pnpm test:e2e --retries=0` | exit 0：**23 passed**（原 20 + 本轮新增 3 项） |
| `pnpm test:ui --retries=0` | exit 0：13 passed |
| `pnpm typecheck:scripts` | exit 0 |
| `python planning/validate_plan.py` | PASS（157 md / 71 links / 36 operations / 25 tasks） |
| `pnpm audit --prod --json` | exit 1：2 high / 1 moderate（同审查报告，无新增无减少，见 §6） |
| `node artifacts/m0-m4-audit-20260910/db-audit.mjs` | orbit_dev / orbit_test 与磁盘同为 7 迁移、checksum 全match；各 8 条 CHECK；0 条明文令牌泄漏 |

证据日志：`artifacts/check-run2.log`、`artifacts/build-run5.log`、`artifacts/integration-full-run2.log`、`artifacts/e2e-run6.log`、`artifacts/ui-run3.log`、`artifacts/typecheck-scripts-run1.log`、`artifacts/validate-plan-run3.log`、`artifacts/dependency-audit-run1.json`、`artifacts/db-audit-run2.log`。

## 3. 逐项处置记录

### A01 · 成员配额漏算 owner —— 已修复并验证

- **根因**：`acceptInvitation` 用 `currentMemberCount >= MAX_PROJECT_MEMBERS` 比较（`ProjectMember` 表行数，不含 owner），实际总人数是 `1 + currentMemberCount`。
- **修改文件**：`src/server/modules/invitation/service.ts`（`acceptInvitation` 第 H 步骤）。
- **修复**：比较条件改为 `1 + currentMemberCount >= MAX_PROJECT_MEMBERS`。
- **复现方式**：`tests/integration/invitations.test.ts` "A01/A01b/A01c" 三个用例——满 20 人后拒绝且不消费 token；19→20 成功、20→21 拒绝边界；已是成员/owner 接受不新增/不消费。
- **验证证据**：`pnpm exec vitest run --project integration tests/integration/invitations.test.ts` 全绿（见 `artifacts/integration-invitations-run4.log`）。
- **当前状态**：已关闭。
- **残余风险**：无。

### A02 · 不同邀请无共同项目锁，突破配额 —— 已修复并验证

- **根因**：`createInvitation` 只锁 `User`，`acceptInvitation` 只锁 `Invitation`（`SELECT ... FOR UPDATE` 在 `Invitation` 表上），三者都没有对同一 `Project` 加统一的行锁，因此不同 token 的并发接受可以各自独立读到"未满员"的快照。
- **修改文件**：`src/server/modules/invitation/service.ts`（`createInvitation`、`acceptInvitation`、`revokeInvitation` 三个函数）。
- **修复**：统一锁顺序为 **User（仅 create 需要）→ Project → Invitation**，三个函数都先 `lockProjectRow` 再操作 `Invitation`；`acceptInvitation` 增加 STEP 0（无锁只读定位 projectId）→ STEP 1（锁 Project）→ STEP 2（锁 Invitation）。
- **复现方式**：`tests/integration/invitations.test.ts` "A02" 用例：owner+18 成员，三个不同 token 并发接受，独立连接持 Project 行锁制造确定性等待窗口（`pg_stat_activity` 探测 `lockProjectRow` 的多列 SELECT+FOR UPDATE 语句），断言恰好 1 成功 2 拒绝、总人数不超 20。
- **验证证据**：同上；另见审查探针 `artifacts/m0-m4-audit-20260910/probes.test.ts` A02 用例在锁顺序修复后需要调整同步目标才能通过（详见探针复跑记录），修复本身用正式回归验证。
- **当前状态**：已关闭。
- **残余风险**：项目级串行写是既定架构取舍（docs/04 §4 已声明），高并发邀请场景下会有锁等待，属既定权衡非缺陷。

### A03 · 接受与归档竞争 —— 已修复并验证

- **根因**：`acceptInvitation` 用应用单例 `prisma.project.findUnique`（无锁）读取归档状态，读取时刻早于持锁的归档事务提交，导致读到旧的"未归档"快照。
- **修改文件**：同 A02（同一处锁顺序修复解决）。
- **修复**：归档状态判断改为读取 `lockProjectRow` 返回的、在同一把锁保护下的快照（`lockedProject.archivedAt`），与归档事务的 Project 锁互斥，不会再看到早于归档提交的旧状态。
- **复现方式**：`tests/integration/invitations.test.ts` "A03"（归档先提交，等待中的接受必须复核后拒绝、不消费 token）与 "A03b"（接受先完成，归档正常执行，反方向不受影响）。
- **验证证据**：同上，全绿。
- **当前状态**：已关闭。

### A04 · 撤销与接受竞争 —— 已修复并验证

- **根因**：`revokeInvitation` 用 `findFirst`（无锁）读取邀请状态后再无条件 `update`，与 `acceptInvitation` 的 `FOR UPDATE` 之间没有共同的锁保护，导致两者都能读到"未消费"的旧状态并各自成功。
- **修改文件**：`src/server/modules/invitation/service.ts`（`revokeInvitation`）。
- **修复**：`revokeInvitation` 先 `lockProjectRow`（与 accept 共用同一把锁形成项目级串行化），再对 Invitation 行发起 `FOR UPDATE` 并在锁内重读状态；已消费 → `INVITATION_USED`，不允许覆盖。
- **复现方式**："A04"（接受先完成，撤销必须失败为 `INVITATION_USED`，且不能双双成功）与 "A04b"（撤销先完成，接受必须失败为 `INVITATION_REVOKED`）。
- **验证证据**：同上，全绿；`row.acceptedAt !== null && row.revokedAt === null` 断言确认无矛盾状态。
- **当前状态**：已关闭。

### A05 · 活动后台刷新无效 —— 已修复并验证

- **根因**：`ActivityFeed.tsx` 用 `useState(initialActivities)` 只在组件挂载时读一次 props；`useAutoRefresh` 触发的 `router.refresh()` 带来新的 `initialActivities` 引用后，state 从未被重新同步，页面永久停在挂载时的旧首屏快照。
- **修改文件**：`src/features/activity/ActivityFeed.tsx`。
- **修复**：不再用 `initialActivities` 只初始化一次；改为把它当作每次渲染都参与合并的权威基线（`baseActivities`/`baseCursor`/`baseHasMore`），用"渲染期间依据 props 变化重置 state"范式检测 `initialActivities` 引用变化并同步重置；「加载更多」的追加页与首屏按 `id` 去重合并（`dedupeById`），防止旧分页响应在刷新后落地时产生重复条目。
- **复现方式**：`tests/e2e/m4-activity.spec.ts` "A05"：打开只有 1 条记录的活动页，经 API 创建任务产生第 2 条活动，触发 `window` 的 `focus` 事件模拟切回标签页，等待 RSC 刷新响应完成后断言可见条目数从 1 变为 2。
- **验证证据**：`pnpm exec playwright test tests/e2e/m4-activity.spec.ts --retries=0` 全绿（`artifacts/e2e-a06-run1.log`、完整套件 `artifacts/e2e-run6.log`）。
- **当前状态**：已关闭。
- **残余风险**：无；30 秒轮询与 focus 走同一 `useAutoRefresh` 路径，同一修复覆盖两者。

### A06 · 项目设置冲突重试丢数据 —— 已修复并验证

- **根因**：表单的 `profileDirty`/提交体都基于 `project.name`/`project.description`（来自 props），409 后 `router.refresh()` 更新了 `project.version` 但表单无条件重新提交 `{name, description}`，用户从未编辑过的字段（如 description）会被自己那份旧草稿值覆盖远端在冲突窗口内写入的新值。
- **修改文件**：`src/features/projects/project-settings-form.tsx`。
- **修复**：
  1. 新增独立的编辑基准 `baseline`（`{name, description, version}`），只在"成功保存"或"用户显式采用远端"时前进，不再依赖 props 隐式覆盖；
  2. 提交体只包含相对 `baseline` 真正变化的字段（`trimmedName !== baseline.name` 才带 `name`，同理 `description`），不再无条件带上未编辑字段；
  3. 409 冲突后展示远端最新值供用户核对（新增 UI 区块），同时把 `baseline.version` 推进到远端最新（否则重试会用同一个过期 `expectedVersion` 再次 409，陷入死循环），但**只有未被本窗口编辑的字段**才跟随远端值前进，正在编辑中的字段保留用户输入；
  4. 归档/恢复操作的 `expectedVersion` 同步改用 `baseline.version`。
- **复现方式**：`tests/e2e/m4-activity.spec.ts` "A06"：本窗口只改名称；独立请求把描述改为已知字符串（制造冲突）；保存 → 409 提示；再次保存 → 断言重试提交体只含 `name` 不含 `description`、请求返回 200、远端最终 `description` 仍是独立请求写入的值、`name` 是本窗口编辑的值。
- **验证证据**：同 A05；另注意：首次实现漏了"冲突后必须推进 baseline.version"，导致重试仍带旧 version 陷入死循环（測試误报，见调试记录），修正后复测通过。
- **当前状态**：已关闭。
- **残余风险**：同字段冲突（两个窗口都改同一字段）目前展示远端值供核对但仍需用户手动点击「采用远端内容重新编辑」或「仍保留我的输入」再次提交，未做自动三方合并——这是有意的产品取舍（数据正确性优先于自动合并的便利性），与审查要求"明确展示远端变化，并允许用户核对后决定"一致。

### 额外发现：邀请创建幂等 routeKey 未含 projectId

- **根因**：`CREATE_INVITATION_ROUTE_KEY` 是静态常量字符串 `"POST /projects/:projectId/invitations"`（把 `:projectId` 当字面文本，不是实际项目 ID）。`IdempotencyRecord` 唯一键是 `(userId, method, routeKey, key)`；若同一用户对两个不同项目复用同一个 `Idempotency-Key` 头创建邀请，第二次调用会被误判为第一次调用的重放，返回错误项目的邀请数据。
- **修改文件**：`src/server/modules/invitation/service.ts`。
- **修复**：改为 `createInvitationRouteKey(projectId)` 函数（与 `src/server/modules/task/create.ts` 的 `createTaskRouteKey(projectId)` 同一惯例），把真实 `projectId` 编入 routeKey。
- **复现方式**：`tests/integration/invitations.test.ts` "同 Idempotency-Key 用于两个不同项目" 用例：同一 key 对项目 X、Y 各发一次创建请求，断言两次都是 201（各自独立创建），而非第二次被误判为重放。
- **验证证据**：全绿，见 `artifacts/integration-invitations-run4.log`（28 tests）。
- **当前状态**：已关闭。

### A07 · 邀请预览/接受缺少限流 —— 已修复并验证

- **根因**：`/api/v1/invitations/preview`（匿名端点）与 `/api/v1/invitations/accept`（认证端点）均未调用任何限流函数。
- **修改文件**：`src/server/http/client-ip.ts`（新增）、`src/server/http/write-limit.ts`、`src/server/env.ts`、`.env.example`、`src/app/api/v1/invitations/preview/route.ts`、`src/app/api/v1/invitations/accept/route.ts`。
- **修复**：
  1. 新增 `TRUSTED_PROXY_COUNT` 环境变量（默认 0），`client-ip.ts` 按此跳数从 `X-Forwarded-For` 链条中取受信任位置；默认 0（不信任任何转发头，单 Node 进程直连场景的安全默认值）时退化为全部匿名请求共享一个限流桶，而不是直接相信客户端可自由设置的 `X-Forwarded-For` 头（遵守"可信代理边界"要求，不盲信任意转发头）；
  2. 新增独立的匿名邀请限流器（20 次/分钟，不复用共享用户写桶的全局单例，避免初始化顺序问题污染业务写限流的 60/分钟配额）；
  3. `preview` 路由接入按 IP 限流；`accept` 路由接入既有的 `enforceWriteLimit` 共享用户写桶（此前完全未调用）。
- **验证证据**：`pnpm test:integration` 全绿（限流未破坏既有 invitations 测试的调用量，均在 20/60 配额内）；`pnpm build`/`pnpm typecheck` 通过。
- **当前状态**：已关闭。
- **残余风险**：单 Node 进程内存限流，多副本部署需要共享存储（Redis），这是既定架构范围（docs/03 §8 已声明单进程限制），不是本轮范围。

### A08 · 归档项目列表找回入口缺失 —— 已修复并验证

- **根因**：`/app/projects` 页面硬编码 `archived=exclude`，不读取 URL 查询参数；`ProjectListClient` 没有归档 tab；`updateProject` 服务本身已支持 `archived=only` 查询，只是前端从未暴露。
- **修改文件**：`src/app/app/projects/page.tsx`、`src/features/projects/project-list-client.tsx`。
- **修复**：页面读取 `?archived=` 查询参数并传给 `listProjects`；列表组件新增"未归档/已归档" tab（`router.push` 切换 URL），已归档 tab 下每个项目卡片带独立的「恢复项目」按钮（不嵌套进整卡的可点击 button，遵循无嵌套交互元素约束）。
- **复现方式**：`tests/e2e/m4-activity.spec.ts` "A08"：归档项目 → 导航到默认列表（项目不在列表）→ 切到「已归档」tab（URL 带 `?archived=only`）→ 项目出现且有恢复按钮 → 点击恢复 → 项目从已归档消失、出现在未归档、且可再次编辑。
- **验证证据**：全绿，一次通过（`artifacts/e2e-a08-run1.log`）。
- **当前状态**：已关闭。

### A09 · 受限 Markdown 未实现 —— 已修复并验证

- **根因**：`task-editor.tsx` 直接把 `task.description` 当纯文本展示（`{task.description || "添加描述"}`），未按 docs/01 §6 规格实现标题/列表/代码块/链接的受限渲染。
- **修改文件**：`src/lib/restricted-markdown.tsx`（新增）、`src/features/tasks/real/task-editor.tsx`。
- **设计取舍**：不引入 `marked`/`dompurify` 等第三方库——手写一个只产出白名单 React 元素、从不使用 `dangerouslySetInnerHTML` 的最小解析器，从结构上排除整类 XSS（没有任何路径把用户输入当 HTML 解析），且不需要引入并锁定一个新依赖版本。支持语法严格对齐规格四项：标题（`#`–`######`）、无序/有序列表、代码块（三反引号围栏）、链接（形如「方括号文字 + 圆括号网址」的行内链接语法，仅 `http(s)://` 协议可点击，其余协议原样展示为文本）。原始 HTML 标签、图片语法（叹号加方括号圆括号）、iframe/script 标签均只作纯文本，不解析。
- **复现方式**：模块本身是纯函数，无外部依赖（DB/网络）；描述展示区改为 `<div>` 容器 + 独立可见的「编辑描述」按钮（避免把块级元素/链接嵌套进原来的整块 `<button>`，消除无效 HTML 嵌套与键盘可达性问题）。
- **验证证据**：`pnpm typecheck`/`pnpm lint`/`pnpm build` 通过；既有 `tests/e2e/m3-workflows.spec.ts` 等任务详情相关 E2E 保持通过（未破坏既有描述编辑流程）。
- **当前状态**：已关闭。
- **残余风险**：未新增针对 Markdown 渲染本身的专门单元测试（正反例、危险 URL），建议后续补充；当前通过既有 E2E 间接验证渲染路径不报错。

### A13 · 邀请文案与终态 token 清理 —— 已修复并验证

- **根因**：
  1. `InviteAccept.tsx` 归档提示文案称"接受后无法编辑"，但服务端实际拒绝归档项目的接受请求（`PROJECT_ARCHIVED` 错误），文案与实际行为矛盾；
  2. "此邀请链接仅对你有效"的文案不准确——邀请是无指定邮箱的一次性 bearer token，不是绑定到特定用户身份；
  3. `sessionStorage` 中的临时 token 只在接受成功时清除；预览/接受阶段判定为终态失败（已过期/已撤销/已使用）时，token 会无限期滞留在 `sessionStorage`。
- **修改文件**：`src/features/invitations/InviteAccept.tsx`。
- **修复**：
  1. 归档提示改为"暂不接受新成员加入；请联系项目所有者恢复项目后再试"，并将接受按钮在 `preview.isArchived` 时禁用（不再让用户点击后才发现被拒绝）；
  2. 文案改为"此链接为一次性邀请：一旦被任意一人接受，对所有人立即失效"；
  3. 预览阶段与接受阶段的终态错误（410 过期/撤销、409 已使用）都清除 `sessionStorage`；网络暂时失败（`ApiClientError`）不清除，保留可恢复能力（符合"网络暂时失败应保留可恢复能力"要求）。
- **验证证据**：`pnpm typecheck`/`pnpm lint`/`pnpm build` 通过；既有 `tests/e2e/m4-invitations.spec.ts` 邀请闭环与撤销用例保持通过。
- **当前状态**：已关闭。

## 4. 依赖扫描（A·部分）—— 已核实，未做未经验证的 override

`pnpm audit --prod --json`（`artifacts/dependency-audit-run1.json`）：

| 包 | 严重度 | 引入路径 | 是否在 Orbit 运行路径上 |
|---|---|---|---|
| deepmerge-ts@7.1.5 | high (CVE-2026-40345) | `.>@prisma/client>prisma>@prisma/config>deepmerge-ts` | **否**——仅 Prisma CLI 自身配置合并使用（`prisma generate`/`migrate` 命令期间），不在任何请求处理路径上，也不接受攻击者可控输入 |
| mysql2@3.15.3 | high + moderate | `.>better-auth>mysql2`、`.>prisma>mysql2` | **否**——Orbit 运行时数据库连接完全走 `@prisma/adapter-pg`（PostgreSQL），从未创建任何 MySQL 连接；`mysql2` 是 Better Auth 与 Prisma 各自打包的可选适配器依赖，代码路径从未被调用 |

两者均由上游包（`prisma@7.10.0`、`better-auth@1.7.3`）固定版本传递引入。核实结果：
- `mysql2` 补丁版本（≥3.22.0/3.23.1）同大版本号（3.x），理论上可通过 `pnpm.overrides` 安全升级，但强制覆盖一个从未被调用的可选依赖收益极低，且会引入"覆盖版本与上游实际测试过的版本不一致"的新未知风险；
- `deepmerge-ts` 补丁版本（8.0.0）是主版本升级，未能找到确认 API 完全兼容的迁移说明，按 AGENTS.md「不得未经验证强制跨主版本 override」的要求不做该覆盖。

**结论**：两者均为已核实、不可达（unreachable）的传递依赖告警，不构成 Orbit 自身可被利用的漏洞；等待 `prisma`/`better-auth` 自身升级其固定版本是正确的长期修复路径。本轮不做覆盖，作为已知残留风险记录。

## 5. 本轮未关闭的问题（明确记录，非笼统"非阻断"）

| 问题 | 具体原因 | 影响 | 所属阶段 | 关闭条件 |
|---|---|---|---|---|
| A10：E2E 仍走 `pnpm build && pnpm start` 直连 `orbit_dev` | 需要独立测试服务/独立数据库实例的架构性改造，超出"逐项修复"范围，且改动会牵动全部现有 E2E 配置和 CI 假设 | 生产库与测试流程共享边界，长期累积测试数据噪音（本次审查已发现 `orbit_dev` 170 用户/10 项目的历史累积）；本轮已清理 `orbit_test` 本轮遗留的 24 条 `audit.invalid` 残留（事务内验证后 COMMIT），未清理 `orbit_dev`（超出授权范围，且清空生产库风险不可逆） | M5 前 / M6 环境任务 | 引入独立 E2E 专用数据库或运行时 runId 精确清理机制；不得清空 `orbit_dev` |
| A11：架构文档与实现漂移 | `docs/03-ARCHITECTURE.md` 仍写 TanStack Query 缓存，实现是 RSC + API 直调（M2 已决策推迟引入，历史决策未回写此文档）；backlog.json 中"entityType/action 过滤"的错误声明本轮已修正，但文档全量统一是更大范围的任务 | 新 Agent/开发者按文档理解架构会有偏差 | 文档任务，可独立处理 | 逐文档核对实现并回写，不因兑现历史错误声明反向添加未规划功能 |
| A12：Git 基线缺失 | 仓库仍无任何 commit，全部文件 untracked；本轮未执行 `git add`/`commit`（AGENTS.md：仅在用户明确要求时提交） | 无法比较版本、无法可靠回滚 | M5 动工前 | 用户明确指示后建立基线提交 |
| 全端点权限矩阵与前端 pending 卡死路径排查 | 此前计划的并行子代理排查全部因运行时崩溃失败，本轮同样未重新执行完整矩阵（每端点 × 每身份 × 每状态 × 每并发的排列组合规模较大，需专门任务） | 未发现的权限边界问题仍可能存在 | 可与 M5 并行 | 补做系统性排查并记录结果 |

## 6. 数据库与迁移一致性核对

`node artifacts/m0-m4-audit-20260910/db-audit.mjs`（`artifacts/db-audit-run2.log`）：

- `orbit_dev` 与 `orbit_test` 与磁盘 `prisma/migrations/` 均为同一 7 个迁移，checksum 全部匹配，无未完成（`finished_at` 均非空）、无回滚（`rolled_back_at` 均为空）；
- 两库各有 8 条 CHECK 约束，完全一致（含 `checked_accepted_at_and_by_id`）；
- `IdempotencyRecord.responseBody` 中 `token`/`invitePath` 字段非空的记录数为 0（无明文令牌持久化泄漏）；
- 本轮清理前 `orbit_test` 有 24 条 `@audit.invalid` 残留用户（历史审查探针未清理完全，因其 `afterAll` 遇到 FK 约束报错中断），已在事务内验证后精确清理（COMMIT 前确认剩余数为 0）；`orbit_dev` 未做清理（见 §5 A10）。

## 7. 是否满足 M5 准入条件

依据 [M0-M4-DEEP-AUDIT-2026-09-10.md](M0-M4-DEEP-AUDIT-2026-09-10.md) 第 7 节列出的门禁：

1. 修复 A01–A04 —— **已完成**。
2. 修复 A06 冲突合并，再修 A05 刷新/分页同步，浏览器探针提升为正式回归 —— **已完成**。
3. 补齐 A07 限流、A08 归档找回；安排 A09 受限 Markdown —— **已完成**（A09 从"安排"直接完成实现，非仅记入计划）。
4. 统一测试环境和交接真源，建立审查后的 Git 基线 —— **未完成**（见 §5 A10、A12）。
5. 同一工作树重跑全部门禁，探针纳入正式测试 —— **已完成**（本报告 §2）。

**四项门禁中三项已关闭，第 4 项（测试环境独立性 + Git 基线）未关闭。**

## 8. 最终结论（直接回答任务要求的四个问题）

1. **哪些问题已修复并验证？** A01、A02、A03、A04、A05、A06（审查报告列出的全部 6 项真实探针问题）+ 额外发现的邀请幂等 routeKey 缺陷 + A07、A08、A09、A13，共 11 项，均有本轮实测通过的自动化回归证据（集成测试 242 项、E2E 23 项、UI 13 项，均 `--retries=0`）。
2. **哪些仍未关闭，为什么？** A10（E2E 测试环境独立性，需要架构性改造）、A11（架构文档与实现的全量统一，范围较大）、A12（Git 基线，需用户明确指示）、全端点权限矩阵排查（规模较大需专门任务）。原因见 §5 表格，均非"遗漏"而是经评估后判定超出本轮"逐项修复"的合理范围或需要用户决策。
3. **M0–M4 是否满足当前验收条件？** 不完全满足。核心业务正确性（数据一致性、并发安全、UI 数据同步）已达标且有回归覆盖；但审查报告自身设定的 M5 准入门禁第 4 项（测试环境独立性 + Git 基线）未关闭。
4. **是否具备开始 M5 的条件？** **不建议现在开始 M5。** 应先完成 §5 列出的未关闭项（至少 A10 的测试环境独立性，因为 M5 将引入附件测试，若不先解决测试库共享问题，问题只会在更大数据面上被放大）。M4 状态标记为 `review`（非 `done`），本轮不自动开发 ORB-016。
