# 04 · 数据模型与一致性

## 1. 通用约定

业务 ID 使用 UUID；认证库的用户 ID 按其实际 schema 为字符串，业务 userId 字段与之完全同类型，不强行假设 UUID。所有事件时间为 timestamptz/UTC，网络层 ISO 8601；截止日期为 PostgreSQL date，网络层 YYYY-MM-DD。不可用浏览器本地午夜 Date 构造来回传 date-only。

字符串长度同时在 Zod 与数据库可行处限制；整数 version 默认 1。未知 JSON 字段拒绝，不批量展开请求到 ORM。所有业务表增加 createdAt；可变表增加 updatedAt。软删除表的读取默认过滤 deletedAt。

## 2. 实体关系

~~~mermaid
erDiagram
    User ||--o{ Project : owns
    User ||--o{ ProjectMember : joins
    Project ||--o{ ProjectMember : includes
    Project ||--o{ Invitation : invites
    Project ||--o{ Task : contains
    Task ||--o{ Subtask : includes
    Task ||--o{ Comment : contains
    Task ||--o{ Attachment : stores
    Project ||--o{ ActivityLog : records
    User ||--o{ Task : creates
~~~

## 3. 表与字段

### 认证表 / User

Better Auth 的 User、Session、Account、Verification 使用锁定版本的官方 schema/生成结果。User 增加 timezone（IANA，默认 Asia/Shanghai）；name 为显示名称。库要求的唯一约束、索引和关联不擅自删改。密码只由认证库放在其 Account 数据结构中；业务 API 永远不返回这些表的原始记录。

### Project

id UUID PK；ownerId User FK RESTRICT；name varchar(80)；key varchar(8) UNIQUE；description text 默认空；color 枚举 BLUE/PURPLE/TEAL/GREEN/ORANGE/GRAY；archivedAt nullable；version int 默认1；boardVersion int 默认1；nextTaskNumber int 默认1；reservedBytes bigint 默认0；usedBytes bigint 默认0；createdAt、updatedAt。

CHECK key 满足大写格式，version/boardVersion/nextTaskNumber > 0，bytes >= 0。ownerId 是唯一 owner 权限来源。key 永不复用，项目归档不释放 key。索引 ownerId,archivedAt,updatedAt,id。

### ProjectMember

id UUID PK；projectId Project FK RESTRICT；userId User FK RESTRICT；joinedAt。UNIQUE(projectId,userId)，索引(userId,projectId)。仅存非 owner 成员，无 role 字段；服务端拒绝插入 ownerId。人数=1+成员行数，最大20。

### Invitation

id UUID PK；projectId；createdById；tokenHash char(64) UNIQUE；expiresAt；revokedAt nullable；acceptedAt nullable；acceptedById nullable；createdAt。

有效条件：expiresAt>now 且 revokedAt/acceptedAt 均空。acceptedAt 与 acceptedById 同时为空或同时非空；数据库 CHECK。索引(projectId,createdAt,id)，(expiresAt)。明文 token 仅创建响应返回一次。撤销不删除历史记录。

### Task

id UUID PK；projectId；number int；creatorId User FK RESTRICT；assigneeId User FK SET NULL 可空；title varchar(120)；description text；status 枚举 TODO/IN_PROGRESS/DONE；priority 枚举 NONE/LOW/MEDIUM/HIGH；dueDate date nullable；position bigint；completedAt nullable；version int 默认1；deletedAt nullable；createdAt、updatedAt。

UNIQUE(projectId,number)，CHECK number>0、version>0、title trim非空；状态 DONE 当且仅当 completedAt 非空（包括软删除任务）。position 只在服务端处理，不作为客户端浮点数。

索引：(projectId,deletedAt,status,position,id)、(projectId,deletedAt,updatedAt,id)、(assigneeId,deletedAt,status,dueDate,id)。小规模标题搜索用参数化 ILIKE；数据达到瓶颈再评估 trigram，不默认引入搜索服务。编号搜索解析 key-number，仅查询已授权项目。

### Subtask

id UUID PK；taskId Task FK RESTRICT；title varchar(200)；isCompleted bool 默认false；version int；deletedAt nullable；createdAt、updatedAt。索引(taskId,deletedAt,createdAt,id)。显示顺序为 createdAt,id，不实现子任务重排。

### Comment

id UUID PK；taskId；authorId User FK RESTRICT；body text；version int；editedAt nullable；deletedAt nullable；createdAt、updatedAt。正文最大2000。删除时 body 清空，保留 authorId/时间；GET 返回 body=null 与 isDeleted=true。索引(taskId,createdAt,id)。新评论包含客户端幂等键，见 IdempotencyRecord。

### Attachment

id UUID PK；projectId；taskId；uploaderId；clientUploadId UUID；claimedSha256 char(64)；originalName varchar(255)；objectKey text UNIQUE；mimeType；declaredSizeBytes bigint；sizeBytes bigint nullable；sha256 char(64) nullable；state 枚举 UPLOADING/READY/FAILED/DELETED；cleanupPending bool 默认false；errorCode nullable；deletedAt nullable；createdAt、updatedAt。

UNIQUE(taskId,uploaderId,clientUploadId)防止网络重试重复上传；claimedSha256是客户端声明，sha256是服务端实际校验结果。相同uploadId的重试状态语义见05；DTO的uploadId映射clientUploadId，不输出objectKey。

projectId 必须等于父 task.projectId。数据库为 Task 增加 UNIQUE(id,projectId)，Attachment 使用 (taskId,projectId) 复合 FK，防止关联到其他项目。其他子资源不重复存 projectId，通过 task 归属授权。

READY 要求 sizeBytes>0、sha256 非空。文件大小最大10MiB；UPLOADING 预留 declaredSizeBytes，实际字节数必须与声明相符，否则失败。索引(taskId,state,createdAt,id)、(state,cleanupPending,updatedAt)。objectKey 服务端生成 projects/{projectId}/tasks/{taskId}/{attachmentId}，不含原始文件名。

### ActivityLog

id UUID PK；projectId；actorId User FK RESTRICT；entityType PROJECT/MEMBER/TASK/SUBTASK/COMMENT/ATTACHMENT；entityId text；action enum；metadata jsonb；createdAt。只追加，不编辑。

metadata 只允许任务编号、变更字段名称、枚举状态、用户ID、计数等白名单。不要存原始描述、评论、文件内容和令牌。返回 DTO 时可将 actorId 转成当前名字，已删除任务用编号显示。索引(projectId,createdAt DESC,id DESC)。具体 action 清单见 API 文档。

### IdempotencyRecord

id UUID PK；userId；method；routeKey（含真实资源ID的规范化路径）；key varchar(128)；requestHash char(64)；responseStatus int；responseBody jsonb；resourceId nullable；createdAt；expiresAt（24小时）。UNIQUE(userId,method,routeKey,key)。

仅用于事务内完成的小型 JSON 创建/恢复操作；不缓存附件二进制。认证接口使用认证库协议。重放前重新授权并检查目标资源可读，避免退出成员通过旧缓存读取。过期后 key 不再保证去重，客户端在网络不确定时应尽快查询而不是一天后重复提交。

### RateLimitBucket

keyHash PK（不存原始邮箱/IP）；windowStart；count；expiresAt。实际表与 Better Auth 数据库存储方式可分开，不能破坏库 schema。计数原子递增，维护命令清理过期桶。不以 count 的 read-then-write 实现共享限流。

### UploadLease（M6）

id UUID PK；keyHash char(64)；startedAt timestamptz；expiresAt timestamptz；active boolean。索引 (keyHash,startedAt) 和 expiresAt。同用户准入通过事务级 advisory lock 串行化，频率统计 startedAt 的滑动一分钟、并发统计未过期 active。释放只改 active，不删除频率证据；超过 180 秒允许崩溃恢复，维护限批删除过期行。

## 4. 写入事务与锁

所有同项目写入先锁 Project（SELECT FOR UPDATE 或语义等价实现），再检查权限和归档状态，之后按 Task → 子资源顺序锁定。涉及owner活动项目数量的创建/归档/恢复，须先取得User锁再取得Project锁；恢复时检查10项目配额。统一顺序 User（需要时）→ Project → Task → 子资源。必须使用参数化 SQL。网络 I/O 不能位于事务内。

事务最长目标 < 1 秒，SQL 超时初始 5 秒；死锁/序列化冲突仅做有限技术重试，业务版本冲突返回409，不能自动覆盖。项目级串行写是此版本明确取舍，配并发测试后再优化。

| 操作 | 必须原子发生 |
|---|---|
| 创建任务 | 检查配额、取并递增 nextTaskNumber、插入任务、递增 boardVersion、写活动、写幂等记录 |
| 编辑任务 | 校验成员、expectedVersion、负责人归属，更新字段/version，必要时排序与 boardVersion，写活动 |
| 移动任务 | 校验 expectedVersion/expectedBoardVersion、位置计算、状态/completedAt/version、boardVersion、活动 |
| 删除/恢复任务 | 权限、version、deletedAt、恢复时任务数量上限、恢复排序、boardVersion、活动 |
| 接受邀请 | 项目锁、令牌状态、人数检查、成员插入、邀请消费、活动 |
| 移除成员 | 删除成员关系、清空其全部任务负责人（包括软删除任务）、受影响 version++、活动 |
| 评论/子任务写入 | 对象权限、自己的 version、数据修改、父任务 updatedAt、活动 |
| 附件预留 | 任务/项目配额检查、UPLOADING 行、reservedBytes 增加 |
| 附件完成 | 重新授权、READY、reservedBytes 减少、usedBytes 增加、活动 |

项目资料修改递增 Project.version；boardVersion 专管看板成员/顺序集合。成员退出导致任务卡负责人变化，刷新查询即可，不需要递增 boardVersion；task.version 必须增加。任务删除、恢复也必须递增task.version。普通字段规范化后没有语义变化时不更新version和活动；一次PATCH即使修改多个字段也只增加一次version。

## 5. 看板排序算法

每列按 (position,id) 排序，position 初始间隔1024。创建任务追加列尾；空列 position=1024。move 请求给出目标状态和 beforeTaskId；null 表示列尾。服务端从完整列读取邻居，不信任客户端 position。beforeTaskId 不能是自身、不能跨项目、必须属于目标列且未删除。

在前后邻居之间取整数中点；插首时取首项-1024（允许负数）；插尾取末项+1024。如无整数间隙或会超出 bigint 范围，在同一项目锁事务内对目标列按1024重新编号，再计算插入值。内部重编号不改变展示顺序，其他任务 version 不因此增加；本次移动任务 version 增加，boardVersion 增加。

move 带 expectedVersion 与 expectedBoardVersion。任一不匹配返回409，附 currentVersion/currentBoardVersion。无语义变化的 move 直接返回当前任务，不额外写活动和增加版本。PATCH 修改 status 统一复用移动服务，追加目标列末尾；PATCH 本身不接受 position。

创建、跨/同列移动、删除、恢复都会改变 boardVersion。看板读取使用一致快照（REPEATABLE READ 短只读事务）获取列数据、总数与 boardVersion；不能三次独立读取拼接不同时刻的数据。

## 6. 配额与文件一致性

项目锁内计数并检查配额。文件预算条件 usedBytes+reservedBytes+declaredSizeBytes<=200MiB。子任务/任务/成员等上限同样在锁内判断，不能只靠前端。

### 数据保留策略（F19 审查裁定，2026-09-13）

以下数据**刻意不自动清理**，保留是产品决策而非疏漏：

- 软删除任务（回收站）：用户可自行恢复/彻底删除；系统不代为清空。
- 已过期/已撤销/已使用的邀请：作为操作审计与防重放记录保留；撤销邀请是显式动作。
- MoveRecord（移动历史）：看板顺序争议时的审计依据；不做自动裁剪。

容量风险按附录监测（必要时人工清理或由产品变更明确授权后新增迁移），不得由维护脚本自动删除。

软删除任务仍占用附件空间，恢复不需要重新上传。删除附件先把数据库状态变 DELETED 并扣 usedBytes，再尝试删除对象；失败保留 cleanupPending。过期 UPLOADING 清理扣 reservedBytes。清理命令重复运行不重复扣减，所有计数保持非负。

未通过验证的上传不会产生 FILE_UPLOADED 活动；成功后才记。上传期间权限丢失则失败并清理。对象存储与数据库不可能共享事务，必须依靠状态与补偿实现最终一致性。

## 7. 迁移与种子数据

所有 schema 变更生成迁移并审阅 SQL；生产只运行 migrate deploy，不运行 migrate dev/db push。SQL 中约束、索引、复合 FK 都须纳入迁移。

种子数据只允许明确的开发/测试数据库，脚本验证 APP_ENV 与库名并提供目标信息；不输出凭证。不通过删全库实现 seed：使用稳定 fixture ID/upsert，只修改 fixture 范围。测试清库仅限独立测试实例/指定 schema。

fixture 的 now 是可注入基准时间，日期相对基准生成，以便覆盖昨天/今天/未来/无日期/跨时区。不用多年后失效的硬编码“今天”。V1 不需要 AI 表，后续在09新增迁移。

### 迁移 16（20260913090000_align_invitation_restrict）语义与回滚口径

- 变更 1：`Invitation.acceptedById` 外键改 `ON DELETE RESTRICT`。该列是接受行为的审计身份，与 `acceptedAt` 受成对 CHECK（`checked_accepted_at_and_by_id`）约束；原 CASCADE 置空既违反该 CHECK 也会抹掉审计记录。删除曾接受邀请的用户必须先显式处理邀请记录，与移除成员业务路径的显式清理一致。
- 变更 2：删除 `Project_bytes_non_negative_check` 复合 CHECK。它已被 M5 迁移 `20260911033000_add_project_quota_checks` 的 `non_negative_reserved` / `non_negative_used` 两条独立约束完全覆盖；删除只为对齐 schema 与运行库约束清单，防护语义不变，不修改任何数据行。
- 回滚口径：本项目迁移只向前。应用回滚=从备份恢复（docs/M6-OPERATIONS.md）；需修正时编写新的后续迁移，不得改写已应用文件（其字节与 `_prisma_migrations.checksum` 绑定）。


## 2026-09-11 · M5 协议冲突关闭

附件 uploadId 保持 UUID；内部 DELETED + deletedAt 同步，公开 DTO 不返回 DELETED。下载端点保持 Download JSON，url 为 60 秒有效且绑定当前用户的应用签名链接。GET /attachments/{attachmentId}/content 校验签名、当前会话、当前项目成员、父任务未删除和附件 READY 后代理私有 S3 流，强制 attachment、private,no-store；不向客户端暴露 objectKey。该选择取代先前签名存储 URL 与直接二进制响应混用的实现。

上传先持久预留，再有界流接收至私有临时文件并校验实际内容/大小/摘要、流写 S3，最后独立事务复核权限并提交 READY。请求总时限 120 秒；临时文件请求结束删除。维护命令 cleanup:attachments 处理一小时以上失效上传及 cleanupPending 对象；FAILED/DELETED 的待删标志保留至少 3 分钟，让取消中的 PUT 结束后再物理删除。对象删除失败保留待重试标志，已清理对象不重复释放配额。

附件 task 关系在 Prisma 中显式映射 (taskId, projectId) → Task(id, projectId)。20260911093000 仅移除被复合外键覆盖的冗余单列外键；保留跨项目保护和既有 CHECK，避免后续迁移误删手写复合外键。


## 2026-09-11 事件时间与删除缓存修订

事件时间（包括认证表）使用 `@db.Timestamptz(3)`，截止日 `dueDate` 继续使用 `@db.Date`。既有 TIMESTAMP 列按原应用 UTC 语义显式 `AT TIME ZONE 'UTC'` 转换，不依据执行迁移时的会话时区猜测。迁移前核对旧数据来源和默认时区，并比较转换前后的归一化数据指纹。

锁定的 adapter-pg 7.10.0 时间解析器假定 PostgreSQL 返回 UTC 文本，应用连接必须固定 `timezone=UTC`；业务代码不得更改池连接时区。时区回归分别核对数据库 epoch 和恢复 UTC 会话后的 Prisma Date，用户时区仅用于展示及 date-only 筛选。认证 API 继续接收相同的 JavaScript Date。

删除评论的事务同步将其创建幂等响应改为删除占位；旧数据迁移清除已删除评论残留的缓存正文。请求摘要和幂等标识继续保留，但不能再返回已删除正文。

### 综合审查补充（2026-09-13）

Invitation.acceptedBy 使用 RESTRICT，与 acceptedAt/acceptedById 成对 CHECK 一致；V1 不提供删用户功能，未来匿名化需保持审计身份。新增迁移移除 Project 冗余组合非负 CHECK，两个独立非负约束仍保留。维护对账用单一 SQL 快照比较所有 READY/UPLOADING 附件（含软删除任务）与项目 usedBytes/reservedBytes，仅报告偏差，不自动修正。
