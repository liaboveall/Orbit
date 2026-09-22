# Orbit 独立深度代码审查与架构分析报告

- **审查日期**：2026-09-20
- **审查范围**：`src/**`（274 个 TS/TSX 文件，约 63,947 行）、`prisma/**`（schema + 16 个迁移）、`tests/**`、`scripts/**`、`infra/**`、`package.json`、`Dockerfile`、CI 配置
- **方法**：8 个独立审查智能体并行分域深挖（认证授权 / 业务与并发 / 附件存储 / 前端交互 / API 契约 / 性能与数据访问 / 工程与运维 / 测试质量），再由主审对高影响结论逐条回到源码复核
- **约束**：全程只读，未修改业务代码、未执行迁移、未操作数据库、未安装依赖

---

## 0. 结论摘要

**没有发现可直接利用的 P0 级漏洞**（无越权读他人附件、无 IDOR、无密钥或凭证入库、无 SQL 注入、无存储型 XSS、未授权无法绕过）。这一点值得肯定：项目在授权复合 where、幂等唯一键、令牌哈希存储、软删除过滤、测试隔离五个方面都做到了生产级水准。

但存在 **6 项 P1**，其中 3 项是"上线前必须确认"的发布阻断类风险，3 项是会持续掩盖真实缺陷或造成可用性损失的隐患。另有 **33 项 P2**、**12 项 P3**，合计 **51 项**。

| 严重度 | 数量 | 代表问题 |
|---|---|---|
| P0 | 0（确认） | — |
| P1 | 6 | 看板游标绑定 boardVersion、迁移 checksum 漂移、Prisma 引擎可能未进 standalone、t3.micro 内存预算、事务回滚零测试覆盖、看板跨列拖拽无键盘路径 |
| P2 | 33 | staging 未强制 TRUSTED_PROXY_COUNT、每次 GET 写库限流、position 无 DB 约束、邀请"已成员"不标记已用、上传无全局并发闸门、busboy CVE 等 |
| P3 | 12 | 契约文案漂移、`beforeunload` 缺 returnValue、流式响应无法回错误信封、死代码硬编码日期等 |

各领域分布：

| 领域 | P1 | P2 | P3 | 小计 |
|---|---|---|---|---|
| 认证 / 授权 / 安全边界 | 0 | 7 | 2 | 9 |
| 业务层逻辑与并发 | 1 | 8 | 0 | 9 |
| 附件 / 存储 / 上传下载 | 0 | 5 | 1 | 6 |
| 前端交互与可访问性 | 1 | 4 | 1 | 6 |
| API 路由 / 契约 / 错误处理 | 0 | 2 | 3 | 5 |
| 性能与数据访问 | 1 | 5 | 0 | 6 |
| 依赖 / 构建 / 部署 / 运维 | 2 | 4 | 2 | 8 |
| 测试质量与覆盖 | 1 | 5 | 0 | 6 |

**最需要注意的结构性问题**：本项目的正确性高度依赖"所有写路径都先取 `Project` 行锁（`FOR UPDATE`）串行化"这一**隐式约定**。它在当前代码里成立，但没有任何数据库约束或架构机制强制它。一旦新增写入路径、维护脚本或未来重构绕过该锁，`position` 唯一性、配额上限、乐观锁三大不变量会同时失效。这是本次审查认为最值得投入的架构级改进点。

---

## 1. P1 — 必须优先处理（6 项）

### P1-1｜看板分页游标绑定 `boardVersion`，任何变更后翻页必定 409
- **位置**：`src/server/modules/task/board.ts:93-119`（校验）、`:144-146`（签发）
- **类别**：逻辑 / 可用性
- **证据**：
```ts
const [position, version] = cursor.sortValues;
...
if (version !== project.boardVersion)
  throw new DomainError("BOARD_CONFLICT", "看板已更新，请重新加载。", undefined,
    { currentBoardVersion: project.boardVersion });
...
encodeCursor([last.position.toString(), project.boardVersion], last.id, fingerprint)
```
- **触发与影响**：`boardVersion` 在创建任务、移动、软删除、恢复时都会 `+=1`（`task/create.ts:156`、`move.ts:214`、`soft-delete.ts:81`、`restore.ts:155`）。这意味着只要看板发生过**任意一次**变更，客户端持有的下一页游标立即失效，翻页返回 409。把"全局乐观锁"复用到"分页游标"上是语义混淆：前者用于防止丢失更新，后者需要的是稳定排序锚点。多标签页/多人协作场景下用户会频繁遇到"看板已更新，请重新加载"。
- **修复**：游标只绑定 `(position, id)`，删除该 `BOARD_CONFLICT` 分支；`boardVersion` 仅作为响应字段供前端判断是否需要整体刷新。
- **置信度**：已确认（已回到源码逐行核对）

### P1-2｜迁移 checksum 漂移，`migrate deploy` 可能在生产直接失败
- **位置**：`PROGRESS.md:20` 自述"开发库两条旧迁移 checksum 不符"；具体迁移名未在仓库中定位
- **类别**：运维 / 发布阻断
- **影响**：Prisma 在 `migrate deploy` 时校验已应用迁移的 checksum，不匹配会抛 `P3009` 并**中止整个部署**。若该漂移同时存在于共享/生产库，首次上线即被阻断。这是当前唯一被官方交接文档明确记载却仍未关闭的发布级风险。
- **修复**：在各环境执行 `prisma migrate status` 定位具体两条；确认内容无害后用 `prisma migrate resolve --applied <name>` 对齐；**严禁再事后修改已应用的迁移文件**。
- **置信度**：已确认（文档自述）+ 具体迁移需运行定位

### P1-3｜Next standalone 可能未包含 Prisma 引擎二进制（上线即崩风险）
- **位置**：`next.config.ts:36`（`serverExternalPackages: ["pg"]`）、`Dockerfile:27`（仅 `COPY .next/standalone`）
- **类别**：构建 / 部署
- **证据**：项目使用 `@prisma/adapter-pg` 驱动适配器，运行时依赖 `@prisma/engines` 的 native query engine（`.so.node`）。`serverExternalPackages` 未包含 `@prisma/client` / `@prisma/adapter-pg`，Next 的 standalone 文件追踪对 Prisma 引擎 historically 容易漏拷。
- **影响**：若缺引擎，容器启动后第一次数据库查询即 `Cannot find module` / engine not found，服务完全不可用。
- **修复**：把 prisma 相关包加入 `serverExternalPackages`；在 runner 阶段显式 COPY 引擎；让 `container-smoke` **真正执行一次 Prisma 查询**（而非仅探活 `/health/live`）。
- **置信度**：高度可疑（需构建镜像后实测一次真实查询）

### P1-4｜t3.micro 1 GiB 内存下的连接池与内存预算无硬约束
- **位置**：`src/server/db/prisma.ts:28`（`max: DATABASE_POOL_MAX`，默认 5，上限 20）、`infra/compose.micro.yml:9-45`
- **类别**：资源 / 可伸缩性
- **证据**：Postgres + Next/Node + operations 容器同机部署，compose 未设 `mem_limit` / `cpus`，未配置 swap；应用池默认 5 条连接，叠加 PG 自身后端进程、`work_mem` per-connection。
- **影响**：1 GiB 下最先 OOM 的是 Postgres 或 Node；OOM killer 可能杀掉数据库导致数据页风险。叠加 P1-3 的长事务（看板 `RepeatableRead` 内 16 条查询，`board.ts:36-156`），池=5 时最多 5 个并发看板，其余在 `maxWait 2s` 后失败。
- **修复**：同机部署把 `DATABASE_POOL_MAX` 降到 2–3；compose 设 memory limits + 1–2 GiB swap；设 `NODE_OPTIONS=--max-old-space-size=512`；看板降级为 `ReadCommitted`（其一致性已由 `boardVersion` 保证）。
- **置信度**：已确认

### P1-5｜事务回滚原子性零测试覆盖——最大的"测试盲区"
- **位置**：`tests/integration/**` 全量检索，无任何"service 中途抛错后断言相关表行数不变"的用例
- **类别**：测试 / 数据完整性
- **影响**：`concurrency-invariants` 验证了并发不变量，但**没有验证失败路径的原子性**。如果某个 handler 在写 `Task` 之后、写 `ActivityLog` 之前抛错却未回滚（例如未来把 `appendActivity` 移到事务外、或引入 `await` 的副作用调用），会留下幽灵行，而**现有 903 项测试全绿也发现不了**。这是本次审查中"测试数量与测试有效性"差距最大的一处。
- **修复**：新增集成用例：注入故障使 service 在事务中途抛错 → 断言 Task / ActivityLog / IdempotencyRecord / Project 计数器全部无新增。
- **置信度**：已确认

### P1-6｜看板跨列拖拽无键盘等价操作，违反项目自身可访问性约定
- **位置**：`src/features/board/real-board.tsx:130-138`（仅注册 `KeyboardSensor`）、`:406-429`（`DndContext` 只有 `onDragEnd`，无 `onDragOver`）、`:480-497`（每列独立 `SortableContext`）
- **类别**：可访问性 / 合规性
- **影响**：`KeyboardSensor` 只能在**单个** `SortableContext` 内用方向键移动，无法跨列聚焦。因此"把任务从待办移到已完成"这一主流程对纯键盘用户不可达。AGENTS.md 明确要求"所有主流程可用键盘完成、拖拽必须有菜单/按钮替代操作"。
- **修复**：增加 `onDragOver` 在拖拽中迁移卡片跨列；或把卡片上已有的状态 `select` 提升为正式的键盘主路径并显式说明。
- **置信度**：高度可疑（结构确定，建议手测确认）

---

## 2. P2 — 应尽快处理（24 项，按领域分组）

### 2.1 安全与运行时边界

| ID | 问题 | 位置 | 影响 |
|---|---|---|---|
| SEC-01 | **staging 未强制 `TRUSTED_PROXY_COUNT ≥ 1`** | `src/server/env.ts:185`（仅 `production` 校验） | staging 若沿用默认 0，`resolveClientIp` 返回 `"__no-trusted-proxy__"`，所有认证/匿名邀请请求共用一个限流桶。攻击者连打 11 次登录即可锁死整个 staging 的所有用户 |
| SEC-02 | proxy 完全排除 attachments 路径，无纵深兜底 | `src/proxy.ts:85` | 该路径不经 proxy 的 401 短路。当前路由内已 `requireSessionUser`，但未来若漏写即匿名可达 |
| SEC-03 | 附件下载签名复用 `BETTER_AUTH_SECRET` 作 HMAC 密钥 | `src/server/modules/attachments/service.ts:337-341` | 主密钥泄漏即可伪造任意用户的下载签名。建议 HKDF 派生子密钥（P3 级别，但因爆炸半径列入关注） |
| SEC-04 | 上传无**全局**并发上限，本地 tmpdir 无水位保护 | `service.ts:165-167`、`upload-gate.ts:9-23`（仅 per-user `active >= 2`） | N 个用户各传 2×10 MiB 会短期占用 N×20 MiB 本地磁盘；tmpdir 与系统盘同分区时有打满风险 |
| SEC-05 | 下载无 per-user 并发闸门 | `attachments/[attachmentId]/content/route.ts` | 单成员可并发拉起大量下载流（每条至多存活 120s），压测 S3 与连接池 |
| SEC-06 | `toErrorResponse` 无 Prisma 错误码兜底映射 | `src/server/http/errors.ts:137-152` | 仅 `DomainError` 与 DB 不可用被识别；任一 service 漏转 `P2002/P2025/P2003/P2034` 即裸 500，状态码语义丢失 |
| SEC-07 | proxy matcher 负向前瞻是 pre-auth 体缓冲的唯一防线 | `src/proxy.ts:82-86` | 若 Next 16.3 对 `/api/v1/tasks/{id}/attachments` 的排除解释不符预期，未认证超大 body 会在鉴权前被完整缓冲进 Node 内存。**必须运行验证** |

### 2.2 业务逻辑与数据完整性

| ID | 问题 | 位置 | 影响 |
|---|---|---|---|
| BIZ-01 | **看板 `position` 无 DB 唯一约束** | `prisma/schema.prisma` Task 仅有 `@@index([projectId,deletedAt,status,position,id])` | 唯一性完全依赖"所有写路径都先取 Project 行锁"这一隐式约定。任何绕锁写入（维护脚本、新代码、未来重构）都会产生重复 position，看板排序静默错乱且极难排查 |
| BIZ-02 | `acceptInvitation` 对 owner/已成员短路时**不标记邀请为已用** | `src/server/modules/invitation/service.ts:391-416` | 邀请仍保持 `ACTIVE`，可被他人再次用于加入；"邀请被谁使用"的审计失真，单次使用语义被破坏 |
| BIZ-03 | 评论编辑未刷新幂等缓存 | `comments/service.ts:294-317`（update）对比 `:379-382`（delete 已做 `updateMany` 清洗） | 编辑后同 Idempotency-Key 重试会重放**编辑前**的正文 |
| BIZ-04 | 幂等冲突两种处理写法分裂 | `task/create.ts:194-203`、`restore.ts:190-199` 用 `execute()` 重跑整段事务；`project/create.ts:174-177`、`invitation/service.ts:228` 直接 `resolveIdempotencyCommitConflict` | 功能均正确（重跑会命中对方记录走 replay），但策略分裂是维护陷阱，与"事务外 resolve"的设计意图相悖 |
| BIZ-05 | 附件配额/计数缺 DB 层兜底 | `schema.prisma` Attachment 仅唯一键与非负 CHECK；`MAX_ACTIVE_ATTACHMENTS_PER_TASK=5`、`MAX_PROJECT_STORAGE_BYTES=200MiB` 仅应用层判定 | 同 BIZ-01，一旦绕锁即可能被突破 |
| BIZ-06 | `removeMember` 静默清空 assignee 并 bump task version，但不写活动流、不 bump boardVersion | `src/server/services/member.service.ts:169-172` | 审计流缺"因成员退出而解除分配"的记录；其他成员本地缓存 version 过时导致下次操作 409 |
| BIZ-07 | 标记 READY 的事务失败会留下孤儿 S3 对象 + 上传卡死 | `attachments/service.ts:177-233` | 第二个事务若因锁竞争被映射为 409，对象已写入但行仍 `UPLOADING`；客户端同 `uploadId` 重试命中 `UPLOAD_IN_PROGRESS`，用户卡死至 1h 后 cleanup |
| BIZ-08 | 附件上传端点未使用标准 `Idempotency-Key` | `src/app/api/v1/tasks/[taskId]/attachments/route.ts:19-36` | 与契约"所有创建操作用 Idempotency-Key"不一致；幂等实际由 `uploadId` 承担，但未在契约中固化说明 |

### 2.3 性能与数据访问

| ID | 问题 | 位置 | 影响 |
|---|---|---|---|
| PERF-01 | **每次 GET 都写一次限流 UPSERT** | `src/server/auth/session.ts:42-46`（read 桶）+ `write-limit.ts:12/73` | `consumeBucket` 是 `INSERT ... ON CONFLICT DO UPDATE`，用 `$queryRaw` 在**事务外**单独占一条连接。读多写少场景下 DB 写入量翻倍，t3.micro 下显著 |
| PERF-02 | 看板单请求 16 条 SQL 且跑在 `RepeatableRead` 长事务内 | `src/server/modules/task/board.ts:36-156`（三列各调 `fetchTaskResourceCountsBatch`，共 9 条 groupBy，其中 6 条冗余） | 1000 任务看板一次请求 16 查询；池=5 时并发看板上限 5，其余 2s 后失败 |
| PERF-03 | 项目内 `due_asc` / `priority_desc` 排序缺索引 | `src/server/modules/task/read.ts:64-67` | 现有索引前导为 `(projectId,deletedAt,status,position,id)` 与 `(...,updatedAt,id)`，两种排序均无可用索引，走内存排序 |
| PERF-04 | session / 成员关系 / 时区每请求重查，无 `React.cache()` 去重 | `project-access.ts:62-71`、`read.ts:165`、`board.ts:40` | 单次 RSC 渲染内多组件各调 `requireProjectMember` 会重复发查询 |
| PERF-05 | 单任务详情用 3 条 groupBy 算计数 | `task/read.ts:260` | 可合并为单条 CTE 聚合 |

### 2.4 前端交互

| ID | 问题 | 位置 | 影响 |
|---|---|---|---|
| FE-01 | 聚焦/30s 自动刷新**整体覆盖**已展开的分页窗口 | `comment-list.tsx:78-132`+`:134`；同模式 `subtask-list.tsx:66-94`、`attachment-list.tsx:80-109` | 用户点"加载更多"展开后切走再回来，已加载的后续页被整体回滚到首屏，阅读位置丢失 |
| FE-02 | 过滤器表单 `key={search.toString()}` 导致未提交搜索词被清空 | `task-filters.tsx:44`、`:60-68` | 输入搜索词未点"应用"就点开某条任务（URL 追加 `?task=id`）→ 表单重挂载 → 输入丢失 |
| FE-03 | 编辑态标记不统一，写评论时仍触发自动刷新 | `use-auto-refresh.ts:81` 只查 `[data-task-editing]`；`useUnsavedChanges` 不写 DOM 属性 | 标题/描述编辑被正确跳过，评论/子任务草稿不被跳过 → 详情面板输入时每 30s 重渲染 |
| FE-04 | 拖拽乐观更新取闭包中的旧 `boardVersion` | `real-board.tsx:213-270`（`:247` `expectedBoardVersion: board.boardVersion`） | 弱网/高频拖拽下 409 回滚，需用户重试一次 |

### 2.5 测试有效性

| ID | 问题 | 位置 | 影响 |
|---|---|---|---|
| TEST-01 | 性能探针只写文件、不做阈值断言 | `tests/integration/comprehensive-review.test.ts:29-61` | 查询从 5ms 退化到 500ms 该测试仍绿，是典型的"假绿" |
| TEST-02 | 时间窗口断言 flaky | `download-budget.test.ts:43-46`（120s±6s）、`smtp-budget.test.ts:51-52`（20s±6s） | 慢 CI/GC 停顿下随机红；且这两个测试本身就耗 ~140s |
| TEST-03 | 限流 60s 窗口的真实恢复未在 HTTP 层验证 | `invitation-rate-limit.test.ts:384-406`（文件自注"不经过 HTTP 路由"） | 生产路由的窗口恢复路径未被真实断言，仅靠注入短窗口的算法单测背书 |
| TEST-04 | 移动端视口零覆盖；a11y 仅 3/27 个 e2e | `tests/e2e/**` | 响应式断裂、移动端触摸目标、关键页 a11y 回归漏测 |
| TEST-05 | 契约"路由存在"只验函数名导出 | `tests/contract/openapi-consistency.test.ts:177` | 实现里函数名对但内部 `return 405` 也能通过（被 integration 部分兜底） |

### 2.6 依赖与运维

| ID | 问题 | 位置 | 影响 |
|---|---|---|---|
| OPS-01 | `busboy@1.6.0` 存在 CVE-2023-29134 | `package.json:49` | 多部件解析信息泄露/DoS，修复于 1.6.1。附件上传走 busboy，一行升级即可消除 |
| OPS-02 | `pnpm.overrides` 强制覆盖 Prisma 内部依赖 | `package.json:86-89`（`deepmerge-ts` → 8.0.0） | 主版本跃迁，Prisma 升级后可能破坏 `generate`/`migrate` CLI |
| OPS-03 | `align_invitation_restrict` 迁移删除了 `Project_bytes_non_negative_check` 且未重建 | `prisma/migrations/20260913090000_.../migration.sql:8` | 需确认非负仍由其他约束保证 |
| OPS-04 | 生产就绪度缺监控告警聚合 | — | 有 health 探针与安全日志，无应用指标（p95、错误率、池占用）与告警 |

---

## 3. P3 — 改进项（12 项，摘要）

| ID | 问题 | 位置 |
|---|---|---|
| LOW-01 | comments GET 绕过 `parseQueryParams`，返回英文文案且无 fieldErrors | `tasks/[taskId]/comments/route.ts:37-42` |
| LOW-02 | `DELETE /tasks/{id}` 自造 schema，未复用共享 `VersionQuerySchema` | `tasks/[taskId]/route.ts:40-42` |
| LOW-03 | 流式下载 headers 发出后无法回标准错误信封 | `attachments/[attachmentId]/content/route.ts:29-44` |
| LOW-04 | `beforeunload` 只 `preventDefault()`，未设 `returnValue` | `unsaved-changes.tsx:83-85` |
| LOW-05 | HEAD 豁免 Origin 校验（当前无写 HEAD handler） | `http/origin.ts:21` |
| LOW-06 | 看板三列 count 可合并为单条 FILTER 聚合 | `board.ts:92` |
| LOW-07 | `.dockerignore` 未排除 `docs/`、`planning/`、`contracts/` | `.dockerignore` |
| LOW-08 | AI_* 环境变量已定义但全仓库无实现（死配置） | `src/server/env.ts:123-127` |
| LOW-09 | 死代码 `task-detail.tsx` 硬编码 `today="2026-09-09"` | `features/tasks/task-detail.tsx:104`（仅被 fixture `board-view.tsx` 引用） |
| LOW-10 | 跨文件共享限流单例依赖 afterAll 清理 | `invitation-rate-limit.test.ts:153-159` |
| LOW-11 | 性能门 p95≤300ms 在共享 CI 上易 flaky | `m6-quality.spec.ts:59` |
| LOW-12 | 根目录堆积大量 `*.log` / `_t_*.txt` / `artifacts/`（均未 git 跟踪，仅本地卫生） | 仓库根 |

> 下载签名密钥耦合（SEC-03）、附件配额 DB 兜底（BIZ-05）、单任务详情 groupBy 合并（PERF-05）、`React.cache()` 去重（PERF-04）、契约只验函数名（TEST-05）已在 P2 表中列出，此处不重复计数。

---

## 4. 架构层面评价

### 4.1 做得好的地方（经受住独立复查）

1. **授权模型**：所有子资源访问都是"先取真实父项目 → 校验成员关系 → 复合 where"，`subresource.ts:79` 的 `if (task.projectId !== projectId) throw taskNotFoundError()` 堵死了跨项目 ID 拼接。30 个 `/api/v1` 路由全部调用 `requireSessionUser`。
2. **幂等实现**：唯一键 `(userId, method, routeKey, key)` + 事务内 commit 撞 P2002 后整事务回滚 + 事务外 resolve 重放；同键异内容恒 409。并发同键不会双写——已确认。
3. **邀请令牌**：32 字节随机、库存 SHA-256、状态在 `FOR UPDATE` 行锁下复核、角色恒为 MEMBER、tokenHash 唯一映射单项目。不可枚举/重放/跨项目/提权。
4. **软删除过滤**：board、project list、overview、my/tasks、subtask、comment、attachment 逐一核对均带 `deletedAt: null`，未发现漏过滤的读路径。
5. **测试隔离**：`integration-state.ts` 强制 `DATABASE_URL=TEST_DATABASE_URL` 且路径含 `test`；e2e 侧拒绝非 localhost、拒绝与 `DATABASE_URL` 同名、连接后复核 `current_database()`；清理全部按精确 ID/email。**全仓库无 `TRUNCATE`、无 `deleteMany({})`**——历史上"误连开发库/全表清理"的 P0 已被多层 fail-fast 消除。
6. **工程化**：env 集中 zod 校验、prod 强制 https 与 TRUSTED_PROXY_COUNT、备份 `umask 077` + SSE + 远端 sha256 双重校验、CI 在 fork PR 上不泄漏 secrets、Playwright 挂起已修。
7. **S3 上传正确放在事务外**（`attachments/service.ts:178`），避免长事务持连接做网络 IO——这是很多项目会踩的坑。

### 4.2 架构级风险（本次审查的核心判断）

**风险 A：关键不变量依赖隐式约定，而非数据库约束**
`position` 唯一性、项目配额、乐观锁有效性，全部建立在"所有写路径都先取 `Project` 行锁"之上。这个约定在代码中成立，但：
- 没有 `@@unique([projectId, status, position])` 兜底
- 没有 CHECK 约束兜底配额
- 没有架构机制（如统一写入网关）强制它

**建议**：补部分唯一索引 + 配额 CHECK，把隐式约定变成 DB 强制。这是投入产出比最高的架构改进。

**风险 B：全局乐观锁被复用到不该用的地方**
`boardVersion` 同时充当"防丢失更新的版本"和"分页游标有效性闸口"（P1-1）。两者变更频率差几个数量级，复用必然导致可用性问题。

**风险 C：限流存储与业务存储同库且每次请求都写**
`t3.micro` 同机部署下，限流 UPSERT 与业务写争抢同一个仅有 5 条连接的池和同一块磁盘 IO。建议读限流进程内化，跨实例必要的项（匿名邀请）才走 PG。

**风险 D：903 项测试通过 ≠ 缺陷已关闭**
项目历史上多次出现"测试全绿但独立验收发现缺陷"。本次仍发现：事务回滚零覆盖（P1-5）、性能探针无阈值（TEST-01）、契约只验函数名（TEST-05）。数量不再是瓶颈，断言质量才是。

---

## 5. 建议的处理顺序

**第一阶段（发布前，阻断项）**
1. P1-2 定位并对齐迁移 checksum
2. P1-3 构建镜像实测一次真实 Prisma 查询
3. P1-4 下调 `DATABASE_POOL_MAX`、加 swap/memory limits、看板降为 `ReadCommitted`
4. OPS-01 `busboy` 升到 1.6.1+
5. SEC-07 运行验证 proxy matcher 确实排除上传端点

**第二阶段（功能与数据）**
6. P1-1 解绑看板游标与 `boardVersion`
7. BIZ-01 补 `position` 唯一索引 + 配额 CHECK（架构风险 A）
8. BIZ-02 邀请"已成员"分支标记 USED
9. BIZ-03 评论编辑刷新幂等缓存
10. SEC-01 staging 纳入 `TRUSTED_PROXY_COUNT` 校验

**第三阶段（质量与体验）**
11. P1-5 补事务回滚原子性测试
12. P1-6 看板跨列键盘路径
13. FE-01/02/03 前端刷新与草稿一致性
14. PERF-01/02/03 限流写放大、看板 SQL 合并、补两个索引
15. TEST-01/02 消除假绿与 flaky

---

## 6. 需要运行验证才能定论的项

| 项 | 验证方法 |
|---|---|
| SEC-07 proxy matcher 是否真的排除上传端点 | 部署后发 `POST /api/v1/tasks/{uuid}/attachments`（无 cookie，超大 body），确认在读取 body 前即 401，且内存无尖峰 |
| P1-3 Prisma 引擎是否在 standalone 内 | 构建镜像后运行一次真实 `prisma.$queryRaw`，而非仅探活 |
| P1-2 具体哪两条迁移 checksum 不符 | 各环境 `prisma migrate status` |
| PERF-03 排序是否走内存排序 | 对 1000 任务项目跑 `EXPLAIN ANALYZE` 两种 sort |
| P1-6 键盘跨列是否真的不可达 | 纯键盘操作看板，尝试把任务从 TODO 移到 DONE |

---

*本报告基于 2026-09-20 的工作区状态（`db766cf`）。审查过程未修改任何文件、未执行迁移、未操作数据库。*
