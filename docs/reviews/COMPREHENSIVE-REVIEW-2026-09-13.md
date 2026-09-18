# Orbit 全项目代码审查与架构分析

- 日期：2026-09-13
- 范围：`src/`（app / server / contracts / features / components）、`prisma/`、`scripts/`、`tests/`、`infra/`、`docs/`、`planning/`
- 方式：7 个专项智能体并行审查 + 1 轮独立交叉核实（V1–V8），全部只读，未修改业务代码、未执行写库命令、未提交或部署
- 代码基线：约 468 个 Git 跟踪文件；Next.js 16.3.4 / React 19.2.8 / Prisma 7.10 / better-auth 1.7.3 / Node ≥24

---

## 0. 总体结论

**代码质量高于同类项目平均水平。** 分层边界（app / server / contracts / features）单向且被 `server-only` 守住；授权在服务层重新判权而非依赖前端按钮；SQL 全部参数化；XSS 通过白名单 React 元素 + 协议校验杜绝；软删除、配额、幂等、并发行锁等不变量均有真实数据库测试覆盖。

**没有发现可被直接利用的 P0 级漏洞。** 但存在 3 项 P1 级问题，且它们的共同特征是**不属于"某个 bug"，而属于"工程治理机制缺失"**——这正是本项目反复出现「审查 → 宣布全量修复 → 独立验收不通过 → 返工」循环的结构性原因。

> 优先级定义：P1 = 会持续制造生产事故或安全事件 / 架构级根因；P2 = 明确缺陷或高概率风险，需排期修复；P3 = 技术债与加固项。

---

## 1. P1 — 必须优先处理

### 1.1 破坏性维护脚本无环境强守卫（曾真实误删数据）

| 位置 | 问题 |
|---|---|
| `scripts/maintenance-cleanup.ts:1-18` | **完全没有环境闸门**。仅 `dotenv.config()` 读 `.env`，直接 `drainExpiredRecords` + `cleanupOrphanAttachmentsLocked`，无条件按 `DATABASE_URL` 执行 |
| `scripts/cleanup-attachments.ts` | 同上，无环境校验 |
| `scripts/cleanup-idempotency.ts:31` | `APP_ENV ?? "development"`，且 `"development"` 在放行集合内 —— **未设 APP_ENV 时，即便 DATABASE_URL 指向生产也会执行** |
| `src/server/modules/maintenance/cleanup.ts`、`src/server/modules/attachments/cleanup.ts` | 底层函数同样无 host/db 白名单 |

**影响**：本地 `.env` 误指生产，或 CI/服务器上误跑 `pnpm maintenance:cleanup`，即静默清理生产数据。破坏面目前限于清理表（IdempotencyRecord / RateLimitBucket / UploadLease 过期行 + 孤儿附件），不直接触业务表，但孤儿附件清理会**真实删除 S3 对象**，不可逆。

**这不是理论风险**：`PROGRESS.md` 已披露"调试清理失误删除 18 个历史夹具用户的 Account/Session 行"，且至今未找回原始清理记录与删除前备份。

**建议**：
1. 三脚本统一 deny-by-default：默认 `--dry-run`，要求显式 `DESTRUCTIVE_OK=1` 且 `DATABASE_URL` 命中 localhost/`orbit_test` 白名单（参照 `scripts/recovery-drill.ts:11` 已有的守卫实现）。
2. 删除附件对象前先写墓碑记录并保留 N 天，而非直接 delete。

---

### 1.2 项目状态无单一真相源 —— 返工循环的根因

| 位置 | 问题 |
|---|---|
| `PROGRESS.md` | append-only 堆叠。每轮新记录把前序全部降级为"历史记录"，文件中同时存在 6 段互相矛盾的"当前最新状态"声明 |
| `planning/backlog.json` | 多数任务 `openAuditGroups: []` 却被标记为 `done`；`applicationStatus` 为 140 字符手工拼接串 |
| `planning/final-audit-2026-09-13.json`（70 组）+ `docs/reviews/*`（8+ 份报告） | 与 backlog 构成**平行治理系统**，彼此可能漂移 |

**影响**：任何参与者（人或 Agent）都无法可靠判断"某个问题到底修了没有"。审查结论因此每次都要从零重建，验收标准由每轮审查者事后从缺陷清单反推，**目标一直在动**，形成打地鼠式修复。这是本项目反复返工的第一性原因。

**建议**：
- `backlog.json` 的 `status` 作为唯一事实源，`openAuditGroups` 非空则工具层面禁止置 `done`（可在 `planning/validate_plan.py` 加断言，该脚本已存在且已在跑）。
- `PROGRESS.md` 改为由脚本从 backlog 生成的只读摘要，禁止手写"当前最新状态"。
- 审查报告只保留最新一份为"当前依据"，其余移入 `docs/reviews/archive/`。

---

### 1.3 Nginx 层无限流 + 错误日志全丢弃

| 位置 | 问题 |
|---|---|
| `infra/nginx.conf:14-37` | `location /api/auth/` 与 `location /` **均无 `limit_req_zone` / `limit_req` / `limit_conn`**，仅有 `client_max_body_size` 与安全头 |
| `infra/nginx.conf:7` | `error_log /dev/null;` —— 代理层错误（upstream 502/504、超时、连接失败）**全部丢弃** |

**影响**：
- 认证端点在代理层零防护。应用层 better-auth 限流（`options.ts:149`，注册 10/60s）是唯一屏障，但应用限流依赖正确解析客户端 IP，且与代理层无联动；单 IP 高频请求仍能打满应用线程池与 5 连接池（见 2.1）。
- 生产发生上游故障时**没有任何代理层证据**，错误日志为空，只能靠应用结构化日志反推，MTTR 显著变长。安全头还在，但可观测性出现黑洞。

**建议**：
- `http {}` 中加 `limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/s;` 与全局 `limit_conn_zone`，对 `/api/auth/` 套 `limit_req ... burst=10 nodelay`。
- `error_log` 改回文件（可保留 `orbit_safe` 脱敏格式处理请求串），并纳入日志轮转。

---

## 2. P2 — 明确缺陷或高概率风险（建议排期修复）

### 2.1 数据库连接池 `max: 5` 过窄
- 位置：`src/server/db/prisma.ts:28`（`max: 5`，`connectionTimeoutMillis: 5000`）
- 影响：Next.js 单实例并发 >5 个事务性请求即排队，5s 后 `connectionTimeoutMillis` 触发并映射为 503。看板/工作台一次渲染含多个查询，加上附件上传两段事务，很容易打满。1GiB micro 部署（见 2.2）更紧张。
- 建议：按实例数与 PG `max_connections` 留余量调整为 10–20，并在 `docs/08-ENVIRONMENT-AND-DEPLOYMENT.md` 写明池容量与实例数的换算关系。

### 2.2 PostgreSQL 未针对 1GiB 主机调优，且无容器内存上限
- 位置：`docs/AWS-MICRO-DEPLOYMENT.md:194-241`、`infra/compose.production.yml`
- 影响：PG 默认 `shared_buffers`(128MB) + Next.js + Nginx 在 1GiB 上争抢，低并发即可能 OOM；文档 §4 明确"暂不设容器硬内存上限"，缺少安全网。
- 建议：挂载 `postgresql.conf` 覆盖 `shared_buffers=96MB`、`max_connections=50`、`work_mem=4MB`；给 web/postgres 设 `mem_limit`。

### 2.3 契约测试只做静态结构比对，捕获不了契约漂移
- 位置：`tests/contract/openapi-consistency.test.ts:171-179`（仅断言 route 文件存在且导出对应 method）、`:557-617`（openapi ↔ Zod 深比对）、`client.test.ts`（mockFetch，不触真 handler）
- 影响：路由实际返回的状态码/信封形状偏离 openapi 时测试**仍然全绿**。871 项测试数量掩盖了契约面缺乏行为验证这一事实——这是"本地全绿但独立验收不通过"的技术成因之一。
- 建议：补一组"用测试 client 真实调用 handler，断言 status + `SuccessResponseSchema`/`ErrorResponseSchema`"的契约行为测试。

### 2.4 附件配额泄漏窗口（最长 1 小时）
- 位置：`src/server/modules/attachments/service.ts:184-232`、`src/server/modules/attachments/cleanup.ts:18`（cutoff = 1h）
- 影响：`putFile` 成功但第二段事务（标 READY + `reservedBytes → usedBytes`）提交失败/回滚时，预留字节仍被占用，最长 1 小时后才由清理脚本释放。用户在此期间无法用满配额。
- 建议：第二段事务内做 S3 存在性确认后再提交，或缩短 cleanup cutoff 并对失败状态主动补偿。

### 2.5 移除成员未 bump `boardVersion`
- 位置：`src/server/modules/member/service.ts:169-177`
- 影响：移除成员会清空其 `assigneeId` 并 `task.version++`，但不递增 `boardVersion`。看板不读 `task.version`，故客户端持有旧 board 时负责人占位变化不会刷新。
- 建议：与 assignee 变更语义一致，一并 `boardVersion++`。

### 2.6 公开演示页的截止日徽标被硬编码日期冻结
- 位置：`src/features/board/task-card.tsx:42` → `SAMPLE_TODAY`（`src/features/shell/fixtures.ts:140` = `"2026-09-08"`）；经 `src/features/demo/demo-view.tsx:31` 进入**公开可访问的 `/demo`** 路由
- 影响：演示页所有"今天截止 / 逾期 / 临近"徽标按 2026-09-08 计算，随时间推移永久错误。生产真实看板（`real-board.tsx:553`）与任务列表（`task-list-client.tsx:365/445`）均使用服务端 `dateInTimezone(user.timezone)`，**不受影响**。
- 建议：`/demo` 复用真实 `today` 计算，或至少在演示数据中使用相对日期。

### 2.7 看板移动端 tab 缺少 tabpanel 语义关联
- 位置：`src/features/board/real-board.tsx:352-380`（tablist/tab）、`:439`（面板 section）
- 影响：`tab` 仅有 `aria-selected`，面板无 `id` / `role="tabpanel"` / `aria-controls`，读屏用户无法建立 tab ↔ 面板关联。a11y 是本项目明确验收项（已有 axe 扫描与 13 项 UI 测试），此为其盲区。
- 建议：给可见列加 `id` + `role="tabpanel"` + `aria-labelledby`，tab 加 `aria-controls`。

### 2.8 排序与过滤缺少索引支撑
- `src/server/modules/task/read.ts:62-70,119-128`：`due_asc` / `priority_desc` 排序无前导列索引，大项目需 filesort → 建议加 `@@index([projectId, deletedAt, dueDate, id])`
- `src/server/modules/project/read.ts:48-50,65-99`：`scope=all/joined` 的半连接 + OR 难命中 `(ownerId, archivedAt, updatedAt, id)` → 建议拆 UNION 或加 `(archivedAt, updatedAt, id)`
- `src/server/modules/attachments/service.ts:49,124`：按 `(taskId, deletedAt, state)` 过滤但索引 `(taskId, state, createdAt, id)` 无 `deletedAt`，需堆过滤

### 2.9 CI 缺容器镜像漏洞扫描
- 位置：`.github/workflows/ci.yml:53-54` 仅有 `pnpm audit`（依赖级）
- 影响：基础镜像与 OS 层传递依赖漏洞无门禁。
- 建议：加 Trivy/Grype 步骤，对 HIGH/CRITICAL `exit-code 1`。

### 2.10 新增业务领域需手工同步 8 处，无脚手架
- 位置：全局流程性缺陷
- 链路：prisma schema + migration → contracts（Zod + openapi.json）→ server（module + mapper + authorization）→ app 路由 → features UI → integration 测试 → docs（01/04/05）→ backlog
- 影响：任一处遗漏即产生契约漂移或权限空洞，而 2.3 的测试盲区又无法兜底。
- 建议：抽取"新增领域 checklist + 模板"，纳入 `planning/validate_plan.py` 校验。

### 2.11 框架版本锁定与私有行为依赖
- 位置：`package.json:38-59`（Prisma/React/Radix/better-auth 全精确锁版本）、`src/proxy.ts`、ADR-017（server props + `router.refresh` 单一真源）
- 影响：Next 16.3.4 的 `router.refresh` 流式交互曾导致内容双树缺陷（已通过撤除 app 级 `loading.tsx` 规避，见 PROGRESS 关键取舍记录）。强依赖框架私有行为，升级任一大版本即可能重新触发。
- 建议：为升级建立专项回归清单（尤其是 loading/流式交互与 middleware/proxy 行为），并先在独立分支验证。

---

## 3. P3 — 技术债与加固项

| 编号 | 位置 | 问题 |
|---|---|---|
| 3.1 | `src/server/modules/task/position.ts:71` 与 `move.ts:72` | `renumberColumnAll` / `renumberColumn` 逻辑重复，`RawColRow` 双份声明。合并为单一 `renumberColumn(tx, projectId, status, { excludeTaskId? })` |
| 3.2 | `src/features/board/task-card.tsx:36` 与 `src/features/tasks/real/task-list-client.tsx:347` | 两个 `TaskCard` 实现并存 |
| 3.3 | `src/server/modules/task/move.ts:236-247` | 同列"已在末尾"的 move 仍重排末位 position、写 MoveRecord + TASK_MOVED + bump boardVersion → 活动流噪声 |
| 3.4 | `src/server/modules/task/move.ts:219/253` | 用未规范化 `taskId`，而 `:205` 用 `normalizedTaskId`（PG UUID 不分大小写故功能正确，但不一致） |
| 3.5 | `prisma/schema.prisma:229` + `20260910001347/migration.sql:16-19` | `Invitation.acceptedBy` 的 `onDelete: SetNull` 与 `checked_accepted_at_and_by_id` CHECK 冲突：删除"接受过邀请"的用户会置空 `acceptedById` 而 `acceptedAt` 非空 → CHECK 失败。当前无删用户路径故为 Latent；建议改 `Restrict` 或放宽 CHECK |
| 3.6 | `src/contracts/error-codes.ts:37,47` | `EMAIL_UNVERIFIED`、`ALREADY_EXISTS` 全仓库无抛出点，死错误码 |
| 3.7 | `src/app/api/v1/tasks/[taskId]/attachments/[attachmentId]/content/route.ts:11` | HEAD 分支用 `new Request("http://local/HEAD")` 伪造请求取 requestId，破坏链路追踪一致性 |
| 3.8 | `subtasks/[subtaskId]/route.ts:73-79`、`comments/[commentId]/route.ts:73-79` | 手工解析 `expectedVersion` 且返回英文 `VALIDATION_ERROR`，绕过统一 `parseQueryParams` 与中文文案约定 |
| 3.9 | `src/components/ui/dialog.tsx:51-73` | window 级 Escape 监听与 Radix `onEscapeKeyDown` 可能双重触发；建议只保留 Radix 回调，在回调内判 `isComposing` |
| 3.10 | `src/features/settings/settings-form.tsx:217-238` | 姓名输入框 Enter 提交缺少 IME 组合态守卫（疑似，多数浏览器已缓解） |
| 3.11 | `src/server/modules/attachments/*` | `reservedBytes/usedBytes` 仅靠事务维护，无周期对账（建议加 `SUM(READY.sizeBytes) = usedBytes` 安全网） |
| 3.12 | `package.json:34` vs `:38-59`；`package.json:50` | 版本策略不一致（AWS SDK 用 `^`，其余精确）；`dotenv` 仅构建/脚本使用，应移入 devDependencies |
| 3.13 | `.github/workflows/ci.yml:37` 与 `:38-41` | 重复 `db:migrate:deploy`（先默认库后 `orbit_test`），语义冗余易误读 |
| 3.14 | `.github/workflows/ci.yml:20,24,55` | Action 仅 pin 主版本 tag（`@v4`），存在漂移风险 |
| 3.15 | `src/app/health/ready/route.ts:1` | 路由层直接 `import { prisma }`，是分层边界的唯一泄漏点 |
| 3.16 | `artifacts/rework-20260913/fresh-source/` | 磁盘上含整份源码快照 + node_modules 副本。已被 `.gitignore:63` 正确忽略，**未入库**，但占磁盘且存在 `git add -f` 灾难性膨胀风险 |
| 3.17 | `prisma/migrations/20260909001003:116` 与 `20260911033000:5-9` | `Project_bytes_non_negative_check` 与新增的两个非负 CHECK 语义重复 |
| 3.18 | `src/features/shell/app-shell.tsx:19,41` | 真实侧栏仍渲染 `SIDEBAR_PROJECTS`（6 个 fixture 项目），代码注释自述"仍为 M0 fixture"。若侧栏属生产路径则为真实缺陷，需确认接线状态 |

---

## 4. 经交叉核实后**排除**的误报（避免误导后续修复）

以下 4 条曾被提出，经实地核实**不成立**或**显著降级**，不应按 P1 处理：

| 原判 | 核实结论 |
|---|---|
| `client.delete()` 与 204 契约冲突导致前端崩溃（原判 P1） | **误报**。4 个 204 DELETE 端点前端从不调用 `client.delete`：成员用原生 fetch（`MembersList.tsx:84`）、邀请原生 fetch（`InvitationsList.tsx:186`）、子任务/附件用 `apiDelete`（`subtask-item.tsx:187`、`attachment-list.tsx:258`），而 `apiDelete` 对 204 短路返回（`api-helpers.ts:56`）。仅 `/tasks/:id` 走 `client.delete`，该端点返回 200 + 信封。降级为"库契约面潜在缺陷，不影响生产" |
| 看板游标绑定 `boardVersion` 导致翻页必失败（原判 P2） | **误报**。`board.ts:145` 确实把 `boardVersion` 编入游标、`:109-115` 不符时抛 `BOARD_CONFLICT`，但前端确实分页（`real-board.tsx:49` 传 cursor + limit:100），冲突仅在**看板发生并发变更**时触发，属正确的乐观并发控制 |
| `TRUSTED_PROXY_COUNT=0` 时限流退化为全局单桶（原判 P2） | **误报**。行为属实（`client-ip.ts:9`、`options.ts:173-174`），但 `env.ts:183` 有生产启动期强制校验（`APP_ENV==="production" && TRUSTED_PROXY_COUNT<1` 则启动失败），不会静默退化 |
| 大量 `onDelete: Restrict` 导致用户无法删除 / 违反被遗忘权（原判 P2） | **降级为有意设计**。`docs/11-DECISIONS-AND-RISKS.md:29` ADR-023 明确"V1 不提供自助注销，未来走匿名化改写归属列"，全仓无生产删用户路径。属未实现功能，非缺陷 |

另：注册接口的账号枚举（better-auth 默认返回 `USER_ALREADY_EXISTS`）**部分成立但降级为 P3** —— 属库默认取舍，且已有 10/60s 限流与邮箱验证（注册不建会话）。

---

## 5. 已确认良好的实践（无需改动）

- **授权**：所有写操作在 service 层重新解析角色；邀请接受强制认证；禁止移除 owner；跨项目拼接被 `task.projectId !== projectId` 拦截。
- **注入防护**：全部 `$queryRaw/$executeRaw` 均为标签模板参数化，无字符串拼接。
- **上传安全**：`objectKey` 服务端 `randomUUID` 生成，文件名拒绝 `/ \` 与控制字符，扩展名 + MIME + 内容魔数三重校验；下载签名绑定 userId，走 `octet-stream` + `nosniff`。
- **并发控制**：`withTransaction` + `lockProjectRow(FOR UPDATE)`；`nextTaskNumber` 单条 `UPDATE … RETURNING` 原子取号；邀请 accept 持双锁；`UploadLease` 用 `pg_advisory_xact_lock`，每用户 ≤2 不超售。
- **游标分页**：指纹绑过滤条件 + 类型/UUID/BigInt 范围校验，防篡改；keyset 用 `(sortKey, id)` 双键 + NULLS LAST，重复键不漏不重。
- **错误处理**：统一信封，500 不透堆栈，DB 不可用 → 503，429 带 `Retry-After`，私有数据统一 `Cache-Control: private, no-store`。
- **开放重定向**：`src/lib/return-to.ts` 正确处理绝对 URL、协议相对、反斜杠绕过、伪协议与控制字符。
- **测试隔离**：`tests/setup/integration-state.ts:7-12` 强制 `TEST_DATABASE_URL` 路径含 `test` 并覆盖 `DATABASE_URL`，误连开发库风险已被拦截。
- **容器与备份**：Dockerfile 多阶段 + non-root + standalone；`backup-database.sh` 有 `set -euo pipefail` + sha256 双向校验 + 异地上传。

---

## 6. 建议的修复顺序

1. **第一周（止血）**：1.1 脚本环境守卫 → 1.3 Nginx 限流与错误日志 → 2.2 PG 内存调优
2. **第二周（机制）**：1.2 状态单一真相源 + `validate_plan.py` 加 `openAuditGroups` 断言 → 2.3 契约行为测试
3. **第三周（正确性）**：2.4 配额补偿 → 2.5 boardVersion → 2.6 演示日期 → 2.7 a11y tabpanel → 2.1 连接池
4. **持续**：2.8 索引、2.9 镜像扫描、2.10 脚手架、第 3 节技术债按性价比清理

> 注意：在 1.2 的治理机制落地前，继续追加测试数量不会降低返工概率——871 项测试已经存在，但它们无法回答"某个问题修了没有"这一验收最核心的问题。
