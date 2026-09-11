# Orbit 当前工作区深入审查 · 2026-09-11

> 历史记录：当前状态与修复验收见 [M5 全量修复关闭报告](M5-REMEDIATION-CLOSURE-2026-09-11.md)。本文保留原时点结论，不再代表当前工作区。

结论：**当前 M5 不能验收，先修复再复核，不宜直接进入 M6 发布流程。** 已确认编译门禁失败、附件授权缺口、上传/下载契约断裂、工作台不可运行、补偿不可运行，以及测试隔离和交付可复现性问题。M0–M4 的 258 项既有数据库回归仍通过；这不证明 M5 完成，也不代表整个旧模块不存在未覆盖问题。

本次按用户要求做审查，未修业务实现，未应用迁移，未清空数据库，未提交代码。仅新增审查证据、报告及交接状态。仓库当前没有任何 Git commit，几乎全部文件未跟踪，因此无法可靠区分“M5 原交付”与“中断前修复”的具体 diff；以下全部针对审查时的工作区。

## 范围与证据

读取产品、数据、API、设计、测试、环境规范与 M5 关闭报告；检查认证/授权入口、项目/任务读写与看板计数、子任务和评论、附件全链路、工作台、Prisma 迁移、前端接线及测试隔离。对高风险代码做定向复现。

| 实际执行 | 结果 | 证据（仓库根目录下） |
|---|---|---|
| `pnpm exec tsc --noEmit` | 失败，10 处 TypeScript 错误 | artifacts/review-20260911-typecheck.log |
| `pnpm lint` | 失败，35 errors / 2 warnings | artifacts/review-20260911-lint.log |
| `pnpm exec vitest run --project unit --project contract` | 24 文件、396 项通过 | artifacts/review-20260911-unit-contract.log |
| `pnpm exec vitest run --project integration --exclude '**/attachment-quota.test.ts' --exclude '**/workbench.performance.test.ts'` | 19 文件、258 项通过 | artifacts/review-20260911-baseline-integration.log |
| `pnpm typecheck:scripts` | 通过 | artifacts/review-20260911-scripts.log |
| `python planning/validate_plan.py` | 通过，仅规划静态检查 | planning/VALIDATION.md |
| `node artifacts/review-20260911-probes.mjs` | 复现上传 schema 不匹配、缺失路由、数据库 SQL 错误与迁移漂移 | 同名 .mjs / .log |
| `node --conditions=react-server --import tsx artifacts/review-20260911-services.ts` | 真实服务连接只读 orbit_test；附件缺失任务返回 []；工作台 42601；清理 void 反序列化失败 | 同名 .ts / .log |
| `git check-ignore`、`git log -1` | 附件源码被忽略；仓库无提交 | 本报告 R13 |

两个新增集成文件因 R14 未执行。未运行本轮 production build、E2E/UI、真实 MinIO 上传下载和性能压测：类型检查已经失败，且缺失契约与测试隔离问题应先修复。历史 E2E/UI 数字不能当成本轮结果。数据库定向探针设置只读连接，只输出结构与错误；258 项旧测试按其独立测试库及精确夹具清理执行，本轮未另做完整两库内容指纹比对。

## 必须优先处理（P1）

### R01 · 当前代码不能通过编译与 lint 门禁

`src/server/modules/attachments/cleanup.ts:141` 引用未定义 `ORPHAN_CLEANUP_LOCK_NAME`。`tests/integration/workbench.performance.test.ts:213` 缺少 beforeEach 导入，另有非法 ProjectColor、未初始化变量等类型错误。lint 实测 35 个错误，含显式 any、ts-ignore、未使用变量及 React effect 问题。此状态不支持“typecheck/check 全通过”的结论。

修复验收：保留 strict 和现有规则，实际重跑 check、scripts typecheck、build；不能靠忽略测试或关规则过关。

### R02 · 附件列表完全缺少资源授权

位置：`src/server/modules/attachments/service.ts:49`、`:64`；`src/app/api/v1/tasks/[taskId]/attachments/route.ts:43`。

路由仅验证登录，service 的 userId 完全未使用；直接按 taskId 查附件，不验证成员、父任务是否删除或 UUID。任何已登录用户知道其他项目 taskId 后，都可获取文件名、上传者 ID、项目 ID、摘要和大小等附件元数据。被移除成员仍可查询。此处不是“下载公开”：下载另有成员检查，但列表已经越权。

实际服务复现：随机不存在任务 + 不存在用户得到 `[]`，而非规范规定的 404；有数据时泄露字段由无授权的查询路径静态确认，本次未导出真实用户附件内容。

修复验收：复用 `resolveReadableTaskSubresource`，覆盖非成员、被移除成员、删任务、非法 ID、归档只读，并只返回契约 DTO。

### R03 · 正常 UI 附件上传必然失败

位置：`src/features/tasks/attachments/upload-button.tsx:106`；`src/app/api/v1/tasks/[taskId]/attachments/route.ts:18`、`:76`、`:91`、`:121`。

UI 按契约提交 uploadId、字符串 declaredSizeBytes、sha256、file。路由却要求 clientUploadId、fileName、mimeType、number 型 declaredSizeBytes，并从 x-sha256 头取摘要。FormData 普通字段一定是字符串，即使手动补齐字段，也不能通过 z.number()。直接用实际路由 schema 验证 UI FormData，四个字段 invalid_type。裸 ZodError 经 toErrorResponse 变成 500。

即使修好请求，成功返回 `{attachmentId}`，而 UI 第 122 行解析完整 AttachmentSchema，仍会报失败；READY 重放也固定返回 201。

修复验收：统一 OpenAPI、UploadAttachmentMetadataSchema、multipart 解析和 AttachmentDTO；真实浏览器上传成功并显示新附件；重放 200；非法元数据 400。

### R04 · 附件列表及下载响应不符合客户端契约

位置：`src/server/modules/attachments/service.ts:49`；`src/features/tasks/attachments/attachment-list.tsx:193`；`src/app/api/v1/attachments/[attachmentId]/download/route.ts:37`。

列表返回 originalName/uploaderId/projectId/sha256Hex，缺少 fileName/uploader/uploadId/errorCode；AttachmentSchema 是 strictObject，因此非空列表不能正常渲染。FAILED 列表也未限制最近 5 条。

下载客户端按 DownloadSchema 读取 JSON `{url,expiresAt,fileName}`，路由却直接返回文件二进制。只改服务端流式代理没有同步产品规范、OpenAPI 和客户端，用户点下载无法完成。流式路由还未设置约定的 private,no-store 响应头。

修复验收：明确并同步唯一下载协议，端到端验证中文文件名、错误响应和私有缓存头；列表成功响应通过运行时 schema。

### R05 · 附件删除/下载绕过父任务状态；并发删除可重复扣费

位置：`src/server/modules/attachments/service.ts:266`、`:281`、`:316`。

删除只调用 requireProjectMember，未验证项目归档或父任务 deletedAt，且使用事务外 prisma、没有 Project 行锁。归档项目仍可删除附件；已删除任务的附件仍可删。下载只排除 DELETED，并未要求 READY，也未验证父任务未删除。

并发两次删除可以都先读到 READY，再分别 decrement usedBytes：若项目还有其他文件，用量可能被重复扣减；若不够则触发非负约束或产生负值（取决于迁移）。成员移除与删除之间也没有共用锁保护。以上并发后果为代码路径分析，未对真实数据发起竞争写入。

修复验收：先锁 Project，锁内复核资源/权限和状态，再以条件更新确保配额只释放一次；覆盖归档、删任务、成员移除竞争、READY 下载及重复删除。

### R06 · 上传不是报告所称“两阶段事务”，存储成功可能成为不可追踪孤儿

位置：`src/server/modules/attachments/service.ts:135` 至 `:259`；`src/server/db/tx.ts` 默认 10 秒 timeout。

UPLOADING 创建、预留、S3 PutObject、READY 更新全部处于同一个数据库事务，且始终持有 Project 锁。对象存储耗时超过事务上限或 PUT 后 DB 失败会回滚附件行，但 S3 对象已存在；只扫描 Attachment 行的清理程序无法发现它。上传期间其他项目写请求也被阻塞。事务助手还允许重试回调，外部 PUT 不应混在可重试的纯数据库事务里。

修复验收：预留事务提交 → 有总时限的存储流写入 → 新事务锁内复核权限及最终状态；失败保留可补偿记录；测试 PUT 成功后 DB 失败、慢上传、断连和成员移除。

### R07 · 孤儿清理无法执行，也不能可靠重试

位置：`src/server/modules/attachments/cleanup.ts:72`、`:89`、`:125`。

真实调用 `cleanupOrphanAttachmentsLocked` 已报 Prisma 无法反序列化 void。pg_advisory_xact_lock 返回 void，并非 acquired:boolean；且独立 SQL 的事务结束即释放锁，不能保护后续循环。最后还引用未定义锁名。

即使绕过入口，内部 SQL 使用不存在的 projects 表、未引号 camelCase 列、`?` 占位符；更新配额与标记附件不是同一事务。只设 deletedAt、不改 state 会违反 Attachment_deleted_state_check。对象删除失败后 cleanupPending=true，却在下次筛选中被排除；普通 DELETED 附件也不在扫描范围。因此它不是“只差定时任务”，而是函数本身与补偿机制均不成立。

官方语义核对：[PostgreSQL advisory lock 函数](https://www.postgresql.org/docs/15/functions-admin.html)。实际 PostgreSQL 返回 acquired 空值，实际 Prisma 服务直接报错，见 services.log。

修复验收：正确事务锁/批次领取、锁内条件更新、原子记账、可重试物理删除、普通删除补偿；连跑两次及删除失败后重跑结果一致。

### R08 · 文件输入边界和实际配额校验缺失

位置：附件 route.ts:76；`src/server/modules/attachments/service.ts:105`、`:168`；`src/server/modules/attachments/access.ts` 的 validateFileType。

路由在任何尺寸判断前完整 request.formData() 并复制为 Buffer，未实施元信息 64 KiB、流读取 10 MiB、总时限 120 秒，超大输入可先耗尽内存。服务端类型校验仅信任 MIME 字符串，无扩展名/内容签名/UTF-8 检查。没有确认 actual length == declaredSizeBytes，项目配额以声明大小判断、最后按实际大小累加；可突破 200 MiB 边界。用量估计只聚合 READY，未包含已有预留。

当前先被 R03 挡住，不代表上述后端路径已安全；修通上传时必须一起处理。验收覆盖伪装 MIME、HTML/SVG、非法 UTF-8、空文件、尺寸不符、流中途超限和临界配额。

### R09 · 工作台服务 SQL、结果解码和总数均有错误

位置：`src/server/modules/workbench/service.ts:124`、`:144`、`:150`。

当前真实服务在 orbit_test 报 `42601 syntax error at or near "$5"`：将 `AND status != 'DONE'` 当模板值插入，数据库收到字符串参数而非 SQL 语法。后续还存在 dueDate 未引号被折叠为 duedate、Task.userId/archivedAt 不存在、camelCase 聚合别名未引号、queryRaw 返回行数组却当对象取属性的问题。即使只修 SQL，Number(undefined) 仍产生 NaN。

totalOpen 直接将四个可重叠分类相加：进行中且逾期任务被算两次，没有截止日的 TODO 被漏掉；includeCompleted=true 又会让日期分类计入 DONE。这违背产品 §9，不能用前端 mock 掩盖。

修复验收：固定时钟和多个时区、空数据、交叉分类、无截止日、已完成及跨项目隔离；所有真实响应通过 Workbench/Overview schema。

### R10 · 我的工作台实际上没有接入真实产品流程

位置：`src/app/app/today/page.tsx:23`；`src/features/workbench/workbench-stats.tsx:22`；`src/features/workbench/task-list.tsx:19`；contracts/openapi.json 的 /my/overview、/my/tasks。

真实 /app/today 仍渲染 M0 TodayView fixture。新统计卡返回硬编码数据，任务列表固定空数组，二者未接入真实页面。契约要求的 `/api/v1/my/overview` 和 `/api/v1/my/tasks` 均无 route.ts；额外 `/workbench` 路由未进入 OpenAPI。关闭报告声称 my/tasks 已实现，与文件系统不符。

两个备用组件的 load 函数每次 render 都变化，又作为 useEffect 依赖，会不断触发加载；直接把组件接到页面还会产生重复 effect。此重复加载尚未在现有页面发生，因为组件未挂载。

修复验收：真实账户在首页看到自己负责的任务与准确计数，分类/分页可用、URL 保持筛选，空/错/权限/移动端状态完成。

### R11 · 迁移结构不支持一致重建环境

位置：`prisma/schema.prisma:381`；`prisma/migrations/20260911032000_change_client_upload_id_varchar.sql`。

schema 声明 clientUploadId 为 varchar(64)，类型变更 SQL 却作为 migrations 下散落文件，而非 `<migration>/migration.sql`。只读核对显示 orbit_dev、orbit_test 均仍是 uuid，迁移记录均无这一类型变更。新的非负配额约束仅 orbit_test 已记录应用，orbit_dev 未应用。

产品/OpenAPI 的 uploadId 本来要求 UUID，是否放宽必须先统一规范。修复验收：决定最终类型并正规新增迁移；在新建隔离库完整 migrate deploy 后与 schema 比对。不要改旧已应用迁移或手工改开发库来伪造一致。

### R12 · Git 忽略规则把附件源码排除在交付之外

位置：`.gitignore:39` 的 `attachments/`。

未锚定规则匹配任意深度同名目录，实际 `git check-ignore` 命中了 `src/server/modules/attachments/service.ts` 和 `src/app/api/v1/tasks/[taskId]/attachments/route.ts`，前端同名目录也受影响。rg 默认同样跳过这些文件。正常 git add 将漏交附件功能，干净检出后无法构建。

修复验收：规则限定真实上传存储目录，确认全部业务源码不再被忽略；首次建立可审查提交后再校验干净检出，避免提交任何用户附件或凭证。

### R13 · 新增集成测试存在误连开发库和全表清理风险

位置：`tests/integration/attachment-quota.test.ts:18`；`tests/integration/workbench.performance.test.ts:57`。

附件测试仅设置 APP_ENV=test，直接导入应用 prisma。`src/server/db/prisma.ts` 仍取 DATABASE_URL，并不会因 APP_ENV 自动切换 TEST_DATABASE_URL；按当前配置，这个文件单独运行会写 orbit_dev。它还有创建中途失败后使用未初始化 ID 清理的风险；beforeAll 的 Project key 可能因过长先失败，使 afterAll 更不可靠。

性能测试虽将 Prisma mock 为测试库连接，但 cleanupDatabase 无条件删除 Task、ProjectMember、Session、Account、Verification、User，全表级操作影响既存测试数据；外键失败也可能发生在前面删除已经提交之后。另有不存在的 users_id_seq/projects_id_seq、缺少 beforeEach、非法 color/任务字段、无真实负责人、计数器永远过滤掉自身记录等缺陷。附件测试还误认为直接插入 Attachment 会自动增加 Project.usedBytes，而 schema/迁移没有这类触发器。

因此本轮明确排除这两个文件，不能声称完整 integration 全通过。修复验收：先严格锁定独立测试数据库和精确夹具 ID，再重写有效断言；真实数据库验证业务，Mock 仅用于外部存储故障隔离。

## 后续必须修复（P2）

### R14 · 上传重放没有比较元数据，objectKey 唯一范围也不一致

位置：`src/server/modules/attachments/service.ts:144`、`:154`、`:175`。

相同 uploadId 的 READY 记录直接返回成功，不比较原文件名、MIME、声明大小和 claimedSha256；第二份不同内容只要带自己的正确摘要也会被当成旧成功。UPLOADING 返回 IDEMPOTENCY_CONFLICT，未按规范返回 UPLOAD_IN_PROGRESS。DELETED 被排除查询但数据库唯一键仍保留，重试会撞唯一约束而不是清晰业务错误。objectKey 不包含 uploaderId/附件 id，而数据库去重键含 uploaderId，同任务不同上传者复用 uploadId 会碰撞。

验收：同 key 同元数据 READY=200，不同元数据=409；进行中/失败/已删除有明确分支；对象键使用服务端唯一附件 id。

### R15 · 子任务和子资源菜单错误复用了“可删任务”权限

位置：`src/features/tasks/real/task-editor.tsx:72`、`:524`；task-panel.tsx 的 canDelete 传参。

canDelete 表示 owner 或任务创建者，却被等同 isProjectOwner，导致普通任务创建者看到删除他人评论/附件入口（服务端评论仍会拒绝）；反过来，非创建者的普通成员无法操作子任务，因为 canEdit 要求 canDelete。规范允许所有成员编辑子任务。

验收：将项目角色和任务删除权限分别传入；owner、任务创建成员、其他成员三种身份走真实 UI 验证。不是通过扩大服务端权限让错误按钮成功。

### R16 · 评论/子任务网络重试会新建重复内容

位置：`src/features/tasks/comments/comment-list.tsx:137`；`src/features/tasks/subtasks/subtask-list.tsx:92`。

每次点击提交重新 crypto.randomUUID()。当服务器已提交但响应丢失，用户按提示重试使用新 key，会再建一条。后端幂等实现不能补救客户端换 key。

验收：为一次逻辑提交保留 key 和规范化 body；模拟响应丢失，重试后仅一条记录和活动。主动修改内容/新建才生成新 key。

### R17 · 子资源不会随后台刷新同步，评论分页还会重复和乱序

位置：三个子资源 List 的 useEffect 仅依赖 taskId；comment-list.tsx:114、:145。

父页面 router.refresh 保留客户端组件状态，taskId 不变不会重新触发这些自取数 effect；他人新增、编辑和删除的评论/子任务不会通过约定的 30 秒或聚焦刷新同步。子资源本地写入也未统一刷新父列表计数。评论只加载第一页时发布新评论，直接把最新记录拼到第一页末尾；随后加载历史页直接追加且不按 id 去重，产生顺序错误、重复 key，最后一页还会再次包含自己的新评论。

验收：双浏览器协作、聚焦恢复、保留本地编辑、父计数同步；31+ 评论时先发布再分页，顺序与去重正确。

### R18 · M5 聚合计数引入每任务四次查询的性能回退

位置：`src/server/modules/task/mappers.ts:16`；task/read.ts:224、task/board.ts:139、workbench/service.ts:177。

每条任务分别查四个 count；100 条列表增加 400 次 SQL，初次三列各 50 张看板增加 600 次。看板还在同一事务/连接上执行，Promise.all 不会变成数据库多连接并行。这与“优化为两次查询”的性能说明相反。此处是查询数量静态确认，未实测 p95/p99，不能据此虚构毫秒数。

验收：批量 groupBy/聚合关联，真实监听数据库查询事件计数；1000 任务基准测延迟和错误率。修复性能测试的伪计数器后再记录性能结论。

### R19 · 附件成功写操作缺失活动记录

位置：`src/server/modules/attachments/service.ts` 的 uploadAttachment/deleteAttachment。

上传成功和删除均未调用 appendActivity，父任务更新时间也未同步；FILE_UPLOADED/FILE_DELETED 在活动中缺失。报告所称事务一致的协作垂直流程不成立。

验收：业务成功同事务产生一条活动；失败/重放不重复；日志和响应不得包含对象键、正文、存储内部错误。当前上传 catch 还把原始存储错误拼入返回值，路由直接回显，应一并改为稳定领域错误。

## 完成状态与测试证据的纠偏

M5-CLOSURE 报告称四项完整实现并具备上线条件，同时承认工作台 mock；声明的 `/my/tasks`、独立 comments.pagination/attachment.compensation/workbench.timezone 等测试文件不在当前正式测试目录。258 项其实是仍能通过的旧回归集合，其 task/idempotency 测试不能代替附件上传、子任务/评论真实协作验收。报告还将 DELETED、FK 规则、类型迁移等写成与现有 schema/SQL 不一致的形式。

README 仍写 M5 待开始，PROGRESS 写完成，backlog.applicationStatus 写 M0_M7_VERIFIED，但 M6/M7 明确 todo。这是交接状态失真，不是只需补写一份总结。此次将 M5 与 ORB-016～019 标为 review，保留旧报告作为历史声明，并以本报告为当前审查依据。

未作为已发生问题报告：未使用的 toAttachmentDTO 确实含 objectKey，但当前 HTTP list 没调用该 mapper，故不能声称已有 objectKey HTTP 泄露；生产共享限流、部署、备份本属 M6 待做，不能混称 M5 新增缺陷；未发现证据证明当前已有用户数据泄露或丢失。

## 建议修复顺序和重新验收门槛

1. 先修测试隔离、Git 忽略和编译门禁，建立可复现基线，避免验证时损坏数据。
2. 修附件授权及唯一契约，再实现有界上传、可恢复事务、配额、幂等与补偿；同步活动与真实 MinIO 故障测试。
3. 对齐工作台 API 路由和查询，接上真实页面，补固定时钟、负责人、归档/删除过滤及分页测试。
4. 修子资源权限、重试 key、协作刷新及批量计数，增加双用户/移动/键盘真实流程。
5. 新建隔离库完整迁移；check + scripts typecheck + integration + build + E2E/UI，检查两库夹具清理与内容指纹。只有新证据覆盖本报告后才恢复 M5 done，再推进 M6。
