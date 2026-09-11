# Orbit 独立审查报告 · M4 准入门禁复验

- 日期：2026-09-10（本轮，约 13:45—14:15 本地时间）
- 审查者：独立审查 Agent（Kiro / KiroCrew）
- 工作区：`D:\FullStack\Orbit`
- 证据目录：`artifacts/independent-review-2026-09-10-1345/`（本轮新建，未覆盖任何历史证据目录）
- 范围：截至声称完成的 M4（ORB-013/014/015），并复查其对 M0—M3 的影响
- 本轮**未修改**任何应用源代码、正式测试、迁移文件、schema 或 `.env*`；**未执行**任何 `scripts/cleanup-*` 维护脚本；**未清空**任何数据库；未提交 Git

---

## 一、明确结论

> **更新（2026-09-10 修复轮次后）**：本节及第二至第七节记录的是**修复前**的审查结论，原文保留不改写。用户随后要求按结论修复，三项阻断 BLK-01/02/03 与 High ISS-04 均已修复并重新实测通过（integration 232 零跳过、e2e 20 与 ui 13 在 `--retries=0` 下全绿）。**当前判定：M4 达到既定验收门禁，具备进入 M5 的条件**，残留 ISS-09 / ISS-11 / Git 基线为非阻断项。逐项修复内容与复测数据见 [第九节](#九修复轮次2026-09-10-142014455同一-agent)。

**M4 未通过准入。当前实际状态为 `M4_REVIEW_REQUIRED`，不具备进入 M5 的条件。**

M4 的功能主体确实已经实现，且上一轮报告（`M4-RECHECK-2026-09-10.md`）列出的 B01—B05 中**有四项是真实且有效的修复**（详见第五节）。构建与邀请页的阻断已经解除：本轮 `pnpm build` exit 0，`/invite` 实测返回 200。**并发消费邀请这一最严重的数据一致性缺陷已被真正修复**——代码里是真实的 `SELECT … FOR UPDATE` 行锁，配套的正式测试也已被强化为「恰好一人成功、恰好一人失败」，并在本轮实际通过。

但同时存在 3 项必须先解决的阻断，且 `PROGRESS.md` 与 `planning/backlog.json` 当前记录的验收状态与实测不符：

1. **BLK-01 · 测试库缺少第 7 个迁移，R07 约束在测试库根本不存在**（dev 与 test 库 schema 漂移）。
2. **BLK-02 · R07 约束的验证测试从未成功运行过**——套件在 `beforeAll` 即崩溃，7 条测试全部 skip，因此「R07 已验证」这一结论没有任何测试支撑。
3. **BLK-03 · M4 核心功能「邀请闭环」没有任何通过的浏览器证据**——唯一覆盖该闭环的 E2E 用例失败，撤销用例因此未运行。

另外，`PROGRESS.md` 声称的 **「516 tests passed, 0 failures」「E2E ✅ (20 tests)」「UI ✅ (13 tests)」与本轮实测直接矛盾**：三个套件（integration / e2e / ui）本轮均为失败退出。

> 关于文档自相矛盾：`README.md` 当前称「构建、邀请消费并发及新迁移仍阻断」，`PROGRESS.md` 顶部称「M4_COMPLETED + OPTIMIZATION_COMPLETE，可安全进入 M5」。**两者都不准确**：README 所述的构建与并发阻断已确实修复，而 PROGRESS 所述的全绿与可进入 M5 并不成立。

### 补充：仓库没有任何 Git 提交

`git log` 报 `your current branch 'master' does not have any commits yet`，全部 30 个顶层条目均为 untracked（`??`）。M0—M4 的全部工作没有任何版本历史，无法 diff、无法归因、无法回滚。这不是本轮新增问题（历史交接记录中多次出现「本地工作区 master（无 commit）」），但在准备进入 M5 前，它放大了后续每一次「修复引入回归」的风险。本轮遵循约定未擅自提交。

---

## 二、本轮实测检查结果

全部命令在 `D:\FullStack\Orbit` 下执行；环境：Windows / pwsh、Node v26.8.1、pnpm 10.34.5、Python 3.14.7；Docker 容器 `orbit-postgres`（127.0.0.1:5433）、`orbit-mailpit`、`orbit-minio` 均 healthy。

| 命令 | 退出码 | 结果 | 证据 |
|---|---|---|---|
| `pnpm check` | **0** | 通过（lint + typecheck + unit + contract） | `01-pnpm-check.log` |
| `pnpm lint` | 0 | 0 error / 0 warning | `02-lint.log` |
| `pnpm typecheck` | 0 | 通过；**`tests/` 确实纳入类型检查** | `03-typecheck.log` |
| `pnpm test:unit` | 0 | **122 passed / 11 files**，0 失败 0 跳过 | `04-test-unit.log` |
| `pnpm test:contract` | 0 | **136 passed / 9 files** | `05-test-contract.log` |
| `pnpm build` | 0 | 通过，**38 条路由**产物齐备 | `06-build.log` |
| `pnpm test:integration` | **1** | **失败**：1 suite 收集失败 + 16 files passed；**225 passed / 7 skipped（232）** | `07-integration.log`、`07-integration-clean.log` |
| 单独复跑 r07 套件 | **1** | **失败**：`beforeAll` 抛错，7 tests 全部 skipped | `08-r07.log` |
| `pnpm exec prisma migrate status` | 0 | 「Database schema is up to date!」（**仅检查 orbit_dev**） | `09-migrate-status.log` |
| `pnpm test:e2e --retries=0` | **1** | **失败**：**18 passed / 1 failed / 1 did not run（20）** | `11-e2e.log`、`11-e2e-clean.log` |
| `pnpm test:ui --retries=0` | **1** | **失败**：**12 passed / 1 failed（13）** | `12-ui.log`、`12-ui-clean.log` |
| `python planning/validate_plan.py` | 0 | PASS（154 md / 67 links / 36 operations / 25 tasks） | `13-validate-plan.log` |

`pnpm check` 本轮**没有**提前失败，因此其 258 条（122 unit + 136 contract）通过结论成立。这一项与 `PROGRESS.md` 一致。

### 实测 HTTP（生产模式 `pnpm start`，仅绑定 localhost:3000）

| 路径 | 状态码 | 说明 |
|---|---|---|
| `/` | 200 | 正常 |
| `/invite` | **200** | B01 的 500 已修复 |
| `/auth/login` | 200 | 正常 |
| `/app/today` | 307 | 未登录被 proxy 正确重定向 |
| `/invite/sometoken123` | **404** | 见 ISS-04：服务端返回的 `invitePath` 是死链 |

### 数据库实测（只读查询 + docker exec psql）

迁移记录 `_prisma_migrations`：

| 迁移 | orbit_dev | orbit_test |
|---|---|---|
| 20260908162114_init_auth … 20260910001345_add_invitation（前 6 个） | 已应用 | 已应用 |
| **20260910001347_add_invitation_accepted_constraint** | 已应用（另有 1 行 rolled_back） | **缺失** |
| **20260910001346_add_invitation_accepted_constraint**（磁盘上已删除） | 残留 1 行 `rolled_back=t` | 无 |

CHECK 约束：orbit_dev **8 条**，含 `Invitation.checked_accepted_at_and_by_id`，实际定义为

```sql
CHECK ((("acceptedAt" IS NULL  AND "acceptedById" IS NULL)
     OR ("acceptedAt" IS NOT NULL AND "acceptedById" IS NOT NULL)))
```

orbit_test **仅 7 条，没有该约束**。

唯一索引实测存在：`ProjectMember_projectId_userId_key`（UNIQUE `projectId,userId`）、`Invitation_tokenHash_key`。

R01（明文令牌持久化）实测复验：`IdempotencyRecord` 共 69 行（orbit_dev），其中 `responseBody->>'token'` 非空 **0** 行、`invitePath` 非空 **0** 行 → **R01 修复有效，已实测确认**。

---

## 三、问题清单（按严重程度排序）

### BLK-01 · Blocker · 测试库缺少迁移，R07 约束在 orbit_test 不存在

- 位置：`prisma/migrations/20260910001347_add_invitation_accepted_constraint/migration.sql`（未应用到 orbit_test）
- 触发条件：对 `orbit_test` 执行任何依赖该 CHECK 约束的写入
- 预期：两库 schema 一致，非法状态（`acceptedAt` 与 `acceptedById` 一个为空一个非空）被数据库拒绝
- 实际：orbit_dev 有该约束；**orbit_test 没有**，非法状态可写入
- 影响：集成测试运行在与开发/生产不一致的 schema 上，**任何依赖该约束的不变量在测试中都无法被捕获**；`prisma migrate status` 只看 `DATABASE_URL`（orbit_dev），因此该漂移不会被现有工具链发现
- 证据：本报告第二节迁移与约束表；`09-migrate-status.log`
- 修复方向：对 `TEST_DATABASE_URL` 应用 `prisma migrate deploy`；在 `pnpm check` 或集成测试前置中加入「两库迁移一致性」断言
- 回归验收：orbit_test 出现 `checked_accepted_at_and_by_id`；两库 `_prisma_migrations` 的 `migration_name` 集合与磁盘 7 个目录一致且 checksum 相同

### BLK-02 · Blocker · R07 约束验证套件从未成功运行（7 条测试全部 skip）

- 位置：`tests/integration/r07-check-constraint.test.ts:49`（`beforeAll` 内），schema 约束见 `prisma/schema.prisma:151`
- 触发条件：运行 `pnpm test:integration`（每次必然发生，非偶发）
- 预期：7 条测试实际执行并验证 CHECK 约束的四种状态组合
- 实际：`beforeAll` 抛 `PrismaClientKnownRequestError: The provided value for the column is too long for the column's type`，套件收集失败，**7 条测试全部 skipped**
- 根因：测试构造 `key: \`R07${Date.now().toString(36).toUpperCase()}\`` = `"R07"` + 8 字符 = **11 字符**，而 `Project.key` 为 `@db.VarChar(8)`，并另有 `Project_key_format_check` 要求 `^[A-Z][A-Z0-9]{1,7}$`（最长 8）。该测试**在任何环境下都不可能通过**
- 影响：`PROGRESS.md` 把「R07 CHECK 约束迁移成功应用 / 数据库约束验证」列为本轮技术债务清理的核心成果，但**支撑该结论的测试一次都没有真正执行过**；同时它使 integration 套件恒定以 exit 1 结束
- 证据：`08-r07.log`（完整堆栈与 7 条 skip 列表）、`07-integration-clean.log`
- 修复方向：把 key 收敛到 8 字符内（例如 `R07` + 5 位随机 `[A-Z0-9]`）；修好后必须确认 7 条**真的执行并通过**，而不是仍然 skip
- 回归验收：`pnpm test:integration` 中该文件显示 7 passed（0 skipped）；整体 0 failed 0 skipped

### BLK-03 · Blocker · 邀请闭环 E2E 失败，M4 核心功能无通过的浏览器证据

- 位置：`tests/e2e/m4-invitations.spec.ts:147`（断言）；实现侧 `src/features/invitations/InvitationsList.tsx:147`
- 触发条件：运行 `pnpm test:e2e`（确定性失败，与重试无关）
- 预期：owner 创建邀请 → 复制链接 → 第二用户接受 → 出现在成员列表
- 实际：`expect(linkText).toContain("/invite/")` 失败。实际链接为 `http://localhost:3000/invite#token=twYldn…`（哈希片段协议）。该用例失败后，`m4-invitations.spec.ts:202`（owner 撤销邀请）**did not run**
- 判定：**实现是对的，测试是过期的**。`src/app/invite/page.tsx:8` 明确记载这是安全修复 R02——把令牌从路径段/query 迁到哈希片段，避免进入服务端日志与 Referer。E2E 未随之更新
- 影响：ORB-013（M4 的核心交付）**没有任何通过的端到端浏览器证据**；撤销流程本轮完全未被验证。`backlog.json` 中 ORB-013 的 evidence 写「tests/e2e/m4-invitations.spec.ts: 2 tests passed」，与实测不符
- 证据：`11-e2e-clean.log`（含完整失败输出与 `1 did not run`）
- 修复方向：更新 E2E 断言到片段协议（解析 `location.hash` 的 `token=`），并让第二用户通过 `#token=` 打开 `/invite`；同时补一条「匿名打开 → 登录 → 返回 `/invite` → 接受」的用例，覆盖 sessionStorage 恢复路径
- 回归验收：`pnpm test:e2e --retries=0` 达到 20 passed / 0 failed / 0 did not run

### ISS-04 · High · 服务端返回的 `invitePath` 是 404 死链，且被正式测试锁定

- 位置：`src/server/modules/invitation/service.ts:161`；契约 `contracts/openapi.json`（`CreatedInvitation.invitePath`，required）、`src/contracts/dto.ts:162`；测试 `tests/integration/invitations.test.ts:311`
- 触发条件：任何 API 消费方按契约使用 `invitePath` 打开邀请链接
- 预期：`invitePath` 指向一个可用的邀请入口
- 实际：服务端仍生成 `/invite/${encodeURIComponent(token)}`，而对应动态路由已被删除——`src/app/invite/[token]/` 现在是**空目录**，构建产物中不存在该路由，实测 `/invite/sometoken123` → **404**
- 加重情形：`tests/integration/invitations.test.ts:311` 断言 `expect(created.invitePath).toBe(\`/invite/${token}\`)`，**把这个坏格式固化为契约**，因此 integration 全绿与 E2E 失败同时发生、互相矛盾；前端 `InvitationsList.tsx:147` 则完全忽略 `invitePath`，自行拼片段 URL
- 影响：契约层与实现层不一致；R02 的意图（令牌不出现在路径中）在响应体层面**未完成**；应用内流程因前端自建 URL 而侥幸可用
- 证据：本报告第二节 HTTP 表；空目录实测 `ITEM_COUNT=0`
- 备注：`docs/reviews/M4-FINAL-VERIFICATION-2026-09-10.md:64` 把 `const invitePath = \`/invite/${token}\`` 标注为「❌ Path-based exposes token」的**旧代码**，但 `service.ts:161` 至今仍是这一行——该报告宣称的修复在服务端并未落地
- 修复方向：三者取一并同步 openapi + DTO + 测试 + 前端：(a) 移除 `invitePath` 字段，只返回 `token`；(b) 改为返回 `"/invite#token=<token>"`；(c) 恢复 `/invite/[token]` 路由。建议 (a) 或 (b)，与 R02 意图一致
- 回归验收：契约测试断言新形状；`invitePath`（若保留）实测返回 200；`src/app/invite/[token]/` 空目录删除

### ISS-05 · High · PROGRESS.md 与 backlog.json 的验收状态与实测不符

- 位置：`PROGRESS.md`（顶部状态块）、`planning/backlog.json`（`applicationStatus`、M4 milestone、ORB-013 evidence、`latestReview`）
- 实际不符项：
  - 「516 tests passed, 0 failures」→ 本轮 integration / e2e / ui **三个套件均失败退出**；且 516 这一总数把 7 条 skipped 计为通过
  - 「Integration ✅ (225 tests)」→ 225 passed 属实，但**隐藏了 1 个收集失败的套件与 7 条 skipped**，且整体 exit 1
  - 「E2E ✅ (20 tests)」→ 实测 18 passed / 1 failed / 1 did not run
  - 「UI ✅ (13 tests)」→ 实测 12 passed / 1 failed（`--retries=0`）
  - 「R01-R12 独立审查问题全部修复」→ R02 未完成（ISS-04）、R07 未被任何执行过的测试验证（BLK-02）
  - 「下一步：按 docs/06 推进 M5 / ORB-016（子任务清单）」与同文件另一处「M5 / ORB-016（批量操作与工作表视图）」自相矛盾；`backlog.json` 的 ORB-016 标题为**子任务清单**，前者正确
  - 「Member 管理（owner 添加/移除成员、自我退出）」→ 代码中**不存在**「owner 添加成员」端点，`members/route.ts` 仅 GET、`members/[userId]/route.ts` 仅 DELETE；成员只能通过接受邀请加入
- 影响：交接文档把未验证项记为已验证，下一个 Agent 会据此直接开工 M5
- 修复方向：按本报告同步状态（本轮已执行，见第六节）

### ISS-06 · Medium · UI 套件 768px 用例在无重试下失败（被 retries 掩盖）

- 位置：`tests/ui/m0-review.spec.ts:131`
- 触发条件：`pnpm test:ui --retries=0`；同一用例在 390px 与 1440px 通过，**仅 768px 断点失败**
- 预期：详情面板内层 Escape 只关闭「你有未保存的更改」确认框，不连带关闭详情
- 实际：`expect(confirm).toHaveCount(0)` 超时，确认框在 5s 内始终解析到 1 个元素（`14 × locator resolved to 1 element`）
- 影响：`playwright.ui.config.ts` 默认 `retries: 1`，因此历史「13/13 通过」依赖一次重试。这可能是真实的断点相关缺陷（草稿确认框在 768px 未响应内层 Escape），也可能是竞态型 flake；无论哪种，「13/13」都不该作为无条件通过证据
- 证据：`12-ui-clean.log`，含失败截图与 trace 路径
- 修复方向：先用 trace 判定是断点缺陷还是竞态；若为缺陷则修 Drawer/Dialog 的 Escape 分层处理
- 回归验收：`--retries=0` 下 13/13 连续通过 3 次

### ISS-07 · Medium · 迁移历史表存在残留与重复行

- 位置：`_prisma_migrations`（orbit_dev）
- 实际：`20260910001346_add_invitation_accepted_constraint` 残留 1 行 `rolled_back=t`，而该迁移目录**已从磁盘删除**；`20260910001347_add_invitation_accepted_constraint` 有 **2 行**（1 行 rolled_back、1 行 finished）
- 影响：`prisma migrate status` 因忽略 rolled_back 行而报「up to date」，问题被掩盖；迁移历史不再是可信的审计记录。仓库中保留 `scripts/cleanup-migration.ts` 与 `scripts/cleanup-migration-20260910001346.sql` 表明历史表曾被手工改写
- 备注：本轮**未执行**任何清理脚本，未改动历史表
- 修复方向：在可回滚事务中清理已删除迁移的残留行；此后禁止删除已进入数据库的迁移目录，改用新的前向迁移
- 回归验收：两库 `_prisma_migrations` 与磁盘 7 个目录一一对应，无重复、无孤立行

### ISS-08 · Medium · 维护脚本在 Prisma 7 下不可用，且被排除在类型检查外

- 位置：`scripts/cleanup-invitation-constraints.ts:26-27`（及同类 `cleanup-invitation-tokens.ts`、`cleanup-migration.ts`）；`tsconfig.json` 的 `exclude` 含 `scripts`
- 实际：脚本用 `import { PrismaClient } from "@prisma/client"` + `new PrismaClient()`（无 adapter）。本项目 Prisma 7 强制 driver adapter，客户端生成到 `src/generated/prisma`——见 `src/server/db/prisma.ts` 用 `new PrismaClient({ adapter: new PrismaPg({…}) })`。因此这些脚本运行时会失败
- 影响：声称用于修数据的维护脚本实际不可用；因 `scripts` 被排除在 `tsc --noEmit` 外，`pnpm check` 永远不会发现
- 备注：本轮按约定**未运行**这些脚本，结论来自代码比对而非执行
- 好消息：`cleanup-invitation-constraints.ts` 中上一轮报告（B03）指出的**反向判断条件已修复**——现在用显式 `OR` 精确匹配两种非法组合，不再误选合法行
- 修复方向：改用 `@/generated/prisma/client` + `PrismaPg` adapter 并加载 `.env.local`；把 `scripts` 纳入类型检查或单独加一条 `tsc -p tsconfig.scripts.json`

### ISS-09 · Medium · E2E 在开发库累积真实账户，测试数据清理不完整

- 位置：`tests/e2e/*`（运行时打到 `DATABASE_URL` = `orbit_dev`）
- 实际（本轮结束后实测）：orbit_dev `User` **154** 行，而 `Project` 仅 2、`ProjectMember` 0；orbit_test 残留 `Project` **38**、`ProjectMember` 16、`Task` 11、`User` 15
- 影响：E2E 在**开发库**注册真实账户，日志显示只清理「user=1、project=2」量级，账户持续累积；orbit_test 残留会随轮次增长，可能在未来触碰 `MAX_ACTIVE_PROJECTS=10` 等配额而造成难以归因的失败。AGENTS.md 要求「只创建和清理本次合成数据」，当前未完全达成
- 备注：本轮运行贡献了其中一部分；154 为多轮累积值。本轮**未清空**任何库
- 修复方向：E2E 全程使用独立库或按运行 ID 前缀在 `afterAll` 精确清理；为残留量加一条门禁断言

### ISS-10 · Low · 文档事实性错误

- `README.md`：称「当前包含 5 个迁移」→ 实际 **7 个**
- `README.md`：称构建与邀请消费并发「仍阻断」→ 两者**均已修复**（本轮 build exit 0、`/invite` 200、并发测试通过）
- `README.md` 与 `PROGRESS.md` 对当前里程碑状态给出互相矛盾的结论（review vs COMPLETED）
- `src/app/invite/[token]/`：R02 重构后遗留的**空目录**，应删除

### ISS-11 · Low · 匿名用户在邀请页缺少明确的登录入口

- 位置：`src/features/invitations/InviteAccept.tsx:86`（`InviteAcceptProps` 中的 `isLoggedIn`、`returnPath` 被声明但未使用，函数只解构 `token: _serverToken`）
- 实际：匿名访客同样直接看到「接受邀请」按钮，点击后由 401 分支跳 `/auth/login?returnTo=/invite`，令牌靠 `sessionStorage` 恢复
- 判定：**流程可用**（401 → 登录 → 回到 `/invite` → 从 sessionStorage 取回令牌 → 接受），仅是先点后知的体验问题，不是阻断
- 备注：令牌改存 `sessionStorage` 是 R02 的设计取舍——避开了 URL/日志/Referer 泄漏，但令牌暴露面转移到同源 XSS。属可接受取舍，记录备查

---

## 四、设计偏好与后续优化（非缺陷，不计入门禁）

- `src/server/modules/invitation/service.ts` 使用 `$queryRawUnsafe` 执行 `SELECT … FOR UPDATE`。参数以 `$1` 绑定，**无注入风险**；改用 `$queryRaw` 模板形式更符合规范，属风格建议
- 成员配额语义：`MAX_PROJECT_MEMBERS = 20` 统计 `ProjectMember` 行，而 owner 不占 `ProjectMember` 行，故实际可达 21 人。若 docs/01 的「含 owner 最多 20」为严格要求，需在计数时 +1；属需要确认的规格细节
- `src/server/modules/rate-limit/redis.ts`（23 行）存在但为骨架。若无任何模块 import 它，建议在 M6 前删除或明确标注，以免与 AGENTS.md「不自行新增 Redis」的边界产生歧义

---

## 五、历史问题复核（对照 `M4-RECHECK-2026-09-10.md` 的 B01—B05）

| 编号 | 上轮结论 | 本轮判定 | 依据 |
|---|---|---|---|
| **B01** 邀请页无法编译，build 失败、`/invite` 500 | P1 阻断 | **已修复并实测通过** | `InviteAccept.tsx` 不再有重复 `"use client"`；`pnpm build` exit 0；`pnpm lint` 0 error；实测 `/invite` → **200** |
| **B02** 新旧邀请协议未贯通；401 跳回同一邀请页 | P1 阻断 | **部分修复** | 401 分支已改为 `router.push("/auth/login?returnTo=/invite")`（`InviteAccept.tsx`），令牌由 sessionStorage 恢复——这部分**已修复**。但服务端 `service.ts:161` 仍返回 `/invite/<token>` 死链 → 见 **ISS-04**；匿名登录入口仍缺失 → 见 ISS-11 |
| **B03** 迁移 1346 语法错误（XOR）+ 清理脚本反向判断 | P1 阻断 | **部分修复** | 1346 已删除，替以 1347，**约束在 orbit_dev 真实存在**且定义正确；清理脚本的反向条件**已修正**为显式 OR。但 1347 **未应用到 orbit_test**（BLK-01），历史表残留（ISS-07），脚本在 Prisma 7 下仍不可运行（ISS-08） |
| **B04** 注释冒充行锁，同一令牌可多人消费 | P1 阻断 | **已修复并实测通过** | `service.ts` 中为真实 `SELECT * FROM "Invitation" WHERE "tokenHash" = $1 FOR UPDATE`，锁内重查全部条件、配额在锁内、update+create+activity 同事务；`ProjectMember_projectId_userId_key` UNIQUE 兜底。正式测试已强化为「**EXACTLY ONE** 成功、**EXACTLY ONE** 失败」并本轮通过 |
| **B05** 配额混用 `MAX_ACTIVE_INVITATIONS=10` 作成员上限 | P2 | **已修复** | `src/server/modules/limits.ts` 中 `MAX_PROJECT_MEMBERS = 20` 为独立常量，`acceptInvitation` 在锁内使用；且身份判断（owner / 已是成员）**先于**配额检查，不再误拒 |

其他 R 编号：

- **R01**（明文令牌持久化）：**已修复并实测确认**——69 条幂等记录中 token/invitePath 非空均为 0
- **R07**（数据库约束）：**约束在 dev 存在，但测试库缺失且验证测试从未运行** → BLK-01 + BLK-02
- **R09**（锁内重新授权）：**已修复，代码确认**——`member.service.ts` 先取 `lockProjectRow`，再在事务内 `resolveProjectAccess` 复核，并复查目标仍为成员
- **R08**（活动语义）：**已修复，代码确认**——自退写 `MEMBER_LEFT`、他人移除写 `MEMBER_REMOVED`，metadata 白名单过滤
- **R12**（测试可信度）：**部分修复**——并发测试已严格化（真实进步），但 BLK-02 引入了一个恒定 skip 的套件，ISS-04 有一条把坏契约固化的断言

### 修复是否引入新回归

- **是（测试层）**：R02 的片段协议改造未同步 E2E，产生 BLK-03；R07 的新测试自身写坏，产生 BLK-02。两者都不是产品功能回归，但都使门禁失真
- 未发现 M0—M3 的功能回归：M2/M3 的 E2E（`m2-vertical`、`m2-no-reload`、`m3-workflows` 共 9 条）与 auth 4 条本轮全部通过

---

## 六、里程碑对照

| 里程碑 | 判定 | 依据 |
|---|---|---|
| **M0** 工程与组件基线 | 已实现且验证通过 | UI 套件 12/13（1 项见 ISS-06）、build、contract 136 |
| **M1** 认证与个人设置 | 已实现且验证通过 | auth E2E 4/4、`/app/today` 307 保护、integration 认证族通过 |
| **M2** 项目与任务生命周期 | 已实现且验证通过 | `m2-vertical` + `m2-no-reload` 全通过；7 条 CHECK 两库均在 |
| **M3** 列表 / 看板 / 详情编辑 | 已实现且验证通过 | `m3-workflows` 6/6 通过（含 1000 任务分页、拖拽回滚、草稿与 409） |
| **M4** 团队成员与活动 | **已实现但未充分验证 + 存在阻断** | ORB-014 / ORB-015 有通过的 E2E（成员 2/2、活动 2/2）与集成证据；**ORB-013 邀请闭环无通过证据（BLK-03）**，R07 未被执行过的测试验证（BLK-02），测试库 schema 漂移（BLK-01），契约死链（ISS-04） |
| **M5**（ORB-016 子任务清单 / ORB-017 评论 / ORB-018 附件 / ORB-019 我的工作台与时区） | 尚未进入，**不计为缺陷** | 见下 |
| M6 / M7 | 尚未进入 | — |

**关于「未来里程碑不算缺陷」的核实**：`/app/today`（我的工作台）目前仍渲染 fixture（`src/app/app/today/page.tsx`，页面标题字面写「M0 样例」）。经核对 `planning/backlog.json`，真实工作台属 **ORB-019 / M5**，因此**不判为缺陷**。同理 `src/features/board/fixtures.ts` 服务于 `/app/samples/board/[projectId]` 样例路由，真实看板由 `src/features/board/real-board.tsx` 承载（ORB-011 / M3，E2E 已验证真实拖拽落库）。当前阶段不依赖这两项能力。

---

## 七、建议修复顺序

1. **BLK-01** 对 orbit_test 执行 `prisma migrate deploy`（最小改动，立即消除 schema 漂移）
2. **BLK-02** 修 `r07-check-constraint.test.ts:49` 的 key 长度，确认 7 条真正执行通过 → integration 归零失败与零跳过
3. **BLK-03 + ISS-04** 一并处理邀请协议：定稿 `invitePath` 形状，同步 openapi / DTO / `service.ts:161` / `invitations.test.ts:311` / `m4-invitations.spec.ts:147`，删除空目录 `src/app/invite/[token]/`，补匿名登录回流用例
4. **ISS-06** 用 trace 判定 768px 失败是缺陷还是 flake，修复后 `--retries=0` 连续通过
5. **ISS-07 / ISS-08 / ISS-09** 迁移历史清理（可回滚事务）、维护脚本适配 Prisma 7 并纳入类型检查、测试数据隔离与清理
6. **ISS-05 / ISS-10** 文档与 backlog 事实性修正（本轮已同步状态，内容细节仍需交付方补齐）
7. 全部完成后重跑：`pnpm check`、`pnpm build`、`pnpm test:integration`、`pnpm test:e2e --retries=0`、`pnpm test:ui --retries=0`、`python planning/validate_plan.py`，并附两库迁移一致性证据

**M5 准入条件**：BLK-01/02/03 关闭 + ISS-04 定稿，且五个套件在无重试下全绿、零跳过。

---

## 八、证据与方法说明（审查轮次）

本节描述的是**修复前的审查轮次**（第一至第七节的取证方式）；修复轮次另见第九节。

- 本轮实测：第二节全部命令、HTTP 状态、数据库只读查询，日志在 `artifacts/independent-review-2026-09-10-1345/`
- 代码分析（未执行）：ISS-08 维护脚本不可用、ISS-11 匿名入口、第四节各项、R08/R09 的修复确认
- 历史证据（未重复运行）：`docs/reviews/` 下各报告的原始探针结果
- 未验证推测：ISS-06 究竟是断点缺陷还是竞态，需读 trace 才能定性；审查轮次未下结论（修复轮次已依据失败快照定性为竞态，见第九节 F4）
- 副作用声明：审查轮次启动并随后停止了两次 `pnpm start`（localhost:3000）；运行测试在 orbit_dev / orbit_test 留下数据（见 ISS-09），**未清空任何库、未改动用户文件、未终止无关进程、未应用任何迁移、未执行任何清理脚本**
- 计划中的 8 路并行审查子代理（权限、并发、前端、测试可信度、契约、历史、可达性）在启动后全部因运行时进程崩溃（`AcpProcessDied`）失败，故审查轮次改为在主会话内串行完成命令验证与定向代码复核。这意味着**权限与前端状态两个面的覆盖窄于原计划**：已确认 `member.service.ts`、`invitation/service.ts`、成员与邀请路由的服务端授权，但未对全部 18 个 API 端点逐一做四要素（会话/成员/归属/写权限）核查，也未系统性排查前端 pending 卡死路径。本报告不将其记为通过

## 九、修复轮次（2026-09-10 14:20—14:45，同一 Agent）

用户在收到上述审查后要求按结论修复。本节记录修复内容与**修复后重新实测**的结果；第一至第八节保留为修复前的原始审查证据，不做改写。

### 修复后门禁（全部重跑，无重试）

| 命令 | 修复前 | 修复后 | 证据 |
|---|---|---|---|
| `pnpm check` | exit 0（258） | **exit 0**（unit 122 + contract 136） | `35-check-final.log` |
| `pnpm build` | exit 0 | **exit 0** | `25-build-after.log` |
| `pnpm test:integration` | **exit 1**：1 suite 收集失败，225 passed / 7 skipped | **exit 0：17 files / 232 passed / 0 failed / 0 skipped** | `26-integration-after-clean.log` |
| `pnpm test:e2e --retries=0` | **exit 1**：18 passed / 1 failed / 1 did not run | **exit 0：20 passed / 0 failed** | `28-e2e-after-clean.log` |
| `pnpm test:ui --retries=0` | **exit 1**：12 passed / 1 failed | **exit 0：13 passed**（连续 3 次干净通过） | `29-ui-after-clean.log`、`29-ui-run2.log`、`29-ui-run4.log` |
| `python planning/validate_plan.py` | PASS | **PASS** | `32-validate-after.log` |
| `pnpm typecheck:scripts`（本轮新增） | 不存在 | **exit 0** | `34-typecheck-scripts3.log` |

### 逐项修复

**F1 / BLK-01 — 已修复并实测**：对 `TEST_DATABASE_URL` 执行 `prisma migrate deploy`，只应用缺失的 `20260910001347`。两库现均为 7 个迁移、**各 8 条 CHECK 且都含 `checked_accepted_at_and_by_id`**；`_prisma_migrations` 与磁盘 7 个目录一一对应。未触碰业务表。证据 `20-migrate-deploy-test.log`。

**F2 / BLK-02 — 已修复并实测**：`tests/integration/r07-check-constraint.test.ts`
- key 由 `"R07" + Date.now().toString(36)`（11 字符）改为 `"R07" + randomUUID 前 5 位大写`（8 字符），同时满足 `VarChar(8)` 与 `^[A-Z][A-Z0-9]{1,7}$`。
- 修复后暴露出**同一文件内第二个从未执行过的缺陷**：`Constraint metadata` 用 `$queryRaw` 选 `contype`（PostgreSQL `"char"` 类型）导致 Prisma 反序列化失败。已改为 `contype::text` 并为 `pg_get_constraintdef(oid)` 加别名。
- 顺带强化该断言：原先只断言「返回行数 > 0」，约束被改写成任意条件也会通过；现在断言 `contype = 'c'` 且定义文本同时包含四个分支（两字段同 NULL / 同非 NULL）。
- 结果：**7 passed / 0 skipped**（此前 7 条全部 skipped，R07 从未被验证过）。

**F3 / BLK-03 + ISS-04 — 已修复并实测**：统一到 R02 哈希片段协议，字段名与类型不变（`string`，1—300），仅取值形状对齐，openapi 无需改动。
- `src/server/modules/invitation/service.ts`：`invitePath` 由 `/invite/${token}`（404 死链）改为 `/invite#token=${token}`。
- `src/features/invitations/InvitationsList.tsx`：改为**消费服务端 `invitePath`**，不再在前端另行拼接。两处各自构造正是本缺陷长期存在的根因；渲染出的链接与修复前逐字节相同，用户可见行为不变。
- `tests/integration/invitations.test.ts`：断言改为片段格式，并新增「路径部分必须恰好是 `/invite`」以防明文令牌回流到路径。
- `tests/e2e/m4-invitations.spec.ts`：断言改为 `/invite#token=`；导航地址由 `pathname` 改为 `pathname + hash`——片段不属于 `pathname`，只取前者会静默丢弃令牌。
- 结果：邀请闭环与撤销两条 E2E **均通过**（此前 1 failed + 1 did not run）。

**F4 / ISS-06 — 已修复并实测**：`tests/ui/m0-review.spec.ts` 在内层 Escape 前增加**焦点同步屏障**（等确认框内按钮获得焦点再发键），因为 Radix `DismissableLayer` 的键盘监听与 `FocusScope` 在同一提交阶段注册，仅 `toBeVisible()` 通过时监听可能尚未挂载，Escape 会被整个丢弃；768px 恰为 Tailwind `md` 断点边界，重排更易跨帧，故只在该宽度复现。失败证据显示确认框停留在**完全打开且已聚焦**状态、且两个组件均无退出动画，排除了「断言抢跑关闭动画」的解释。
- 该 768px 用例连续 **4/4** 通过；全套件连续 3 次干净通过。
- **刻意没有采用 `toPass` 重试 Escape 的写法**：那属于用重试掩盖失败，正是本报告 ISS-06 批评的做法。断言仍严格要求确认框计数归零。

**F5 / ISS-07 — 已修复并实测**：在可回滚事务内删除 `_prisma_migrations` 的 2 行残留（已从磁盘删除的 `…1346`，以及 `…1347` 的失败重复行），删除条件严格限定 `rolled_back_at IS NOT NULL AND finished_at IS NULL AND applied_steps_count = 0`，事务内验证「7 行 / 7 个不同名 / 0 未完成 / 0 回滚」后才提交。dev、test 与磁盘三方现完全一致。

**F6 / ISS-08 — 已修复**：`scripts/cleanup-invitation-constraints.ts`、`cleanup-invitation-tokens.ts`、`cleanup-migration.ts` 改为 Prisma 7 正确构造（`@/generated/prisma/client` 的相对路径 + `PrismaPg` adapter + 按 `prisma.config.ts` 约定加载 `.env.local`→`.env`），业务逻辑、SQL 与输出未改。新增 `tsconfig.scripts.json` 与 `pnpm typecheck:scripts`（**不并入 `pnpm check`**，保持既有门禁定义不变），现 exit 0。
- 同时修掉两处真实缺陷：`m2-auth-network-errors-verify.ts` 从未安装的 `playwright` 包导入（改 `@playwright/test`）、以及 `mkdir(dir, {recursive:true})` 把选项当回调传（运行时必抛，改 `mkdirSync`）。
- 该脚本在类型解析恢复后暴露约 50 处 strict-null 违规（此前因导入失败退化为 `any` 而被掩盖）。它是 M2 时期一次性验收脚本，逐条加断言需改其控制流，**已整文件排除并在 `tsconfig.scripts.json` 内写明原因与纳入方法**。

**F8 / ISS-10 — 已修复**：README「5 个迁移」改为 7（实测核对）；顶部状态与 IDE 引导链接由过期的 `M4-RECHECK` 指向本报告；删除 R02 重构遗留的空目录 `src/app/invite/[token]`（删除前确认递归文件数为 0）。

### 未修复项（逐项说明原因）

| 编号 | 状态 | 原因与建议 |
|---|---|---|
| **ISS-09** 测试数据残留 | **未修复** | 修复后实测 orbit_dev `User` 159（本轮 E2E 新增约 5）、orbit_test 残留 38 projects / 15 users。正确修法是让 E2E 使用独立库或按运行 ID 前缀在 `afterAll` 精确清理，属测试基础设施改造，有打破本轮刚转绿的 E2E 的实际风险；且按约定不做批量删除（开发库中可能混有你自己的账户与 seed 数据）。建议作为独立任务处理。 |
| **ISS-11** 匿名邀请页无独立登录入口 | **未修复** | 属产品体验取舍而非缺陷（401 → 登录 → 回流 → 从 sessionStorage 取回令牌 → 接受，流程本身可用）。改动会变更 UI 行为，与「保持现有行为不变」冲突，需你先定产品意图。 |
| **Git 基线** | **未做** | 仓库仍无任何 commit。按约定不擅自提交。**强烈建议在开始 M5 前建立基线**，否则后续每次修复都无法 diff 或回滚。 |
| **全端点权限矩阵 / 前端 pending 卡死排查** | **仍未验证** | 原计划的 8 路子代理全灭，这两面覆盖窄于计划（见第八节）。本轮修复未改变这一状态：**不是通过，而是未审**。建议与 M5 并行补做。 |

### 修复后里程碑判定

**M4 达到其既定验收门禁，具备进入 M5 的条件。** 第七节设定的 M5 准入条件为「BLK-01/02/03 关闭 + ISS-04 定稿，且五个套件在无重试下全绿、零跳过」——现已全部满足：check / build / integration（232，零跳过）/ e2e（20，`--retries=0`）/ ui（13，`--retries=0`，连续 3 次）/ validate_plan 均通过。

残留风险以 ISS-09、ISS-11、Git 基线缺失和上述两面未审事项的形式记录在案，均**不构成 M4 功能阻断**，但 Git 基线建议在 M5 动工前先行处理。

### 修复轮次的副作用声明

本节所述修复中：对 `orbit_test` 应用了缺失的迁移 `20260910001347`（仅此一个，业务表未动）；在可回滚事务内删除了 `orbit_dev._prisma_migrations` 的 2 行失败残留；为浏览器套件启动并随后停止了一次 `pnpm start`（localhost:3000，端口已确认释放）。**未清空任何数据库、未 reset、未执行任何 `scripts/cleanup-*`、未改动 `src/generated/**`、未提交 Git。** 修复后复查确认幂等记录中明文 `token` / `invitePath` 仍为 0 条泄漏。E2E 在 orbit_dev 新增约 5 个合成账户（见 ISS-09）。
