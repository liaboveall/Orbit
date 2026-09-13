# 05 · API 契约与语义

## 1. 范围与维护

机器可读的 V1 业务协议见 [openapi.json](../contracts/openapi.json)，OpenAPI 3.1，基路径 /api/v1。认证库挂在 /api/auth/*，遵循锁定 Better Auth 版本的协议，不伪造业务包装。健康检查 /health/live、/health/ready 也不使用业务包装。AI 扩展单独见09，V1 不暴露未实现 AI 路由。

开发时将契约实现为 src/contracts 的 Zod schemas/DTO，并添加契约测试。OpenAPI、运行时 schema 和业务规则必须同步；禁止只有类型声明而没有服务端校验。

## 2. 通用约定

- JSON camelCase；日期时间 UTC ISO 8601；date-only 为 YYYY-MM-DD。
- 业务 ID 是 UUID，userId 是认证库字符串 ID。
- 成功：{data: ..., meta:{requestId}}；列表 meta 增加 nextCursor（可空）、hasMore。
- 错误：{error:{code,message,fieldErrors?,currentVersion?,currentBoardVersion?},meta:{requestId}}。
- 对象响应只返回 DTO 白名单；不输出密码、会话、tokenHash、objectKey、内部堆栈。
- 私有响应 Cache-Control: private, no-store；Vary 按框架配置正确处理 Cookie。
- 201 表示新建成功，200 表示读取/更新/幂等重放结果；204 仅用于无返回值操作。
- PATCH 接受显式字段，缺失表示不改，null 仅在字段允许清空时有效。至少有一个可修改字段。
- 客户端只提交 expectedVersion，不能自行写 version、createdAt、completedAt、creatorId 或 position。
- 所有自有非 GET API 检查 Origin；匿名邀请预览也包含此要求。

## 3. 错误码

| HTTP | code | 行为 |
|---|---|---|
| 400 | VALIDATION_ERROR / INVALID_CURSOR | 字段旁提示；不重试 |
| 401 | UNAUTHENTICATED | 登录并保留合法 returnTo |
| 403 | FORBIDDEN / EMAIL_UNVERIFIED / ORIGIN_NOT_ALLOWED | 显示访问限制。EMAIL_UNVERIFIED 为保留码（邮箱未验证由认证库流程拦截，V1 业务层不抛出） |
| 404 | NOT_FOUND | 不区分不存在和非成员不可见 |
| 409 | VERSION_CONFLICT / BOARD_CONFLICT | 保留草稿/回滚，重新获取 |
| 409 | PROJECT_KEY_TAKEN / PROJECT_ARCHIVED | 项目字段冲突或只读 |
| 409 | INVITATION_USED / ALREADY_EXISTS / IDEMPOTENCY_CONFLICT / UPLOAD_IN_PROGRESS / LOCKED | 按具体业务处理。ALREADY_EXISTS 为保留码（V1 各创建路径用幂等/唯一键语义处理，不抛出该码） |
| 410 | INVITATION_EXPIRED / INVITATION_REVOKED | 显示邀请失效 |
| 413 | PAYLOAD_TOO_LARGE | 拒绝请求并提示 |
| 415 | UNSUPPORTED_FILE_TYPE | 不支持的文件格式 |
| 422 | LIMIT_EXCEEDED / ASSIGNEE_NOT_MEMBER / INVALID_BOARD_TARGET | 配额超限或权限不匹配 |
| 429 | RATE_LIMITED | 限流提示，带 Retry-After |
| 500 | INTERNAL_ERROR | 服务器内部错误 |
| 503 | STORAGE_UNAVAILABLE / SERVICE_UNAVAILABLE | 服务暂时不可用 |

错误 message 给普通用户看；代码供程序分支判断。违反方法/内容类型等框架级错误可在入口转换。不能用 200 携带 error 假装成功。

## 4. 权限入口与子资源

GET /tasks/{taskId} 先定位最小 projectId，再验证当前成员关系和 deletedAt，之后返回内容。所有 comment/subtask/attachment 接口通过 task 的真实归属授权，不能仅验证客户端传来的 projectId。

ProjectDTO.role 是计算得到的 OWNER/MEMBER，不写回数据库。ProjectMemberDTO 返回 userId、name、role、joinedAt，不向队友披露 email。接口不开放全站用户搜索；负责人从项目成员列表选择。

删除与更新操作在事务中重新验证权限，防止“检查之后成员被移除”的竞争。重放幂等响应也必须先验证当前可见性。

## 5. 幂等与并发

需要 Idempotency-Key 的操作：创建项目、创建任务、创建邀请、创建子任务、发布评论、恢复任务。客户端为一次逻辑操作生成 UUID；网络重试复用相同 key 和 body；用户主动新建使用新 key。

服务端按 userId+method+routeKey+key 唯一，保存规范化请求 SHA-256 与响应，24小时有效。同 key 同内容返回原始业务结果与状态码，可附 Idempotency-Replayed:true；不同内容返回409 IDEMPOTENCY_CONFLICT。创建项目没有 Project 锁，使用用户级事务锁或等价并发控制保护项目数量与幂等记录；之后项目写使用 Project 行锁。

邀请明文 token 的创建响应需要重试可取回，但数据库规则禁止保存明文。该接口的幂等记录仅保存邀请 ID 与状态：首次201返回token，重放200返回同邀请元数据且 token=null，提示“链接仅首次展示，可撤销后重新生成”。不能将邀请 token 放进 IdempotencyRecord.responseBody。评论创建重放须优先检查当前删除状态：已删除时返回 200 和当前删除占位（body=null、isDeleted=true），删除事务同步清除创建幂等缓存正文；该规则优先于原响应重放。其余接口按原响应重放。业务 UUID 在构造 routeKey 前统一为小写，大小写等价路径共享同一幂等命名空间。

接受邀请依靠 tokenHash 唯一与 acceptedById 实现业务幂等，不要求 Idempotency-Key。更新/移动使用 expectedVersion；DELETE 子资源/任务使用 query expectedVersion。恢复任务 body 带 expectedVersion，与 key 一起工作。 恢复的首次执行要求任务已删除；同 key 同 body 的已完成恢复，在重新检查当前权限且目标仍可读后重放原结果。创建/恢复的缓存不得绕过当前软删除状态返回任务正文。

Comment、Subtask 自己维护 version。正文编辑与父任务标量字段冲突独立；父任务 updatedAt 因讨论发生变化，但 version 不因此增加。

## 6. 分页与列表

列表采用游标分页，默认30/上限100；评论按 createdAt,id 升序，活动按 createdAt,id 降序。项目/任务默认 updatedAt,id 降序。优先级排序 HIGH→MEDIUM→LOW→NONE；截止日空值排尾。游标必须携带排序字段和id，绑定过滤指纹；服务端校验类型与当前过滤，不把游标当授权证明。

任务列表用 TaskSummary，不包含大段 description；详情 TaskDTO 才包含 description。deleted=only 返回回收站摘要，普通结果 deletedAt=null。分页期间发生更新可能导致列表跨页重复，客户端按 id 去重；不承诺列表的跨请求数据库快照。

看板初次 GET /projects/{id}/board 返回三列及同快照 boardVersion，每列最多limit（默认50）；status+cursor 用于后续加载单列。看板 cursor 必须携带原 boardVersion；版本改变返回409 BOARD_CONFLICT，客户端清空已拼接列并重新获取，避免在过时分页上拖拽。

筛选 q（最多100字）、status、priority、assigneeId、unassigned、overdue；assigneeId 与 unassigned=true 互斥。我的任务可跨当前参与项目，并固定当前用户为负责人；服务端按会话过滤，客户端不能指定任意 userId。

## 7. 示例

邀请列表 `GET /projects/{projectId}/invitations` 仅 owner 可访问，支持 cursor/limit（默认30，上限100），按 createdAt,id 降序。游标绑定项目，响应为 Invitation[] 与 PageMeta；归档后仍可读，永不返回 token/tokenHash。页面的服务端直查不代替该 HTTP 契约。

邀请预览遇到网络失败、429 或 5xx 时，客户端保留本标签页的令牌并提供重试；刷新仍可恢复预览。仅确认不存在、已过期、已撤销、已使用或接受成功后清除。令牌继续通过片段进入页面、通过 POST 请求体传输，不改用 query 参数。

创建任务 POST /projects/{projectId}/tasks，Idempotency-Key: UUID。

~~~json
{
  "title": "完成活动详情页",
  "description": "展示时间、地点与剩余名额。",
  "status": "TODO",
  "priority": "HIGH",
  "assigneeId": null,
  "dueDate": "2026-10-12"
}
~~~

更新任务 PATCH /tasks/{taskId}：

~~~json
{"expectedVersion": 3, "title": "完善活动详情页与空状态", "dueDate": null}
~~~

移动任务 POST /tasks/{taskId}/move：

~~~json
{"expectedVersion": 4, "expectedBoardVersion": 12, "toStatus": "IN_PROGRESS", "beforeTaskId": null}
~~~

move 成功 data 为 {task:TaskDTO,boardVersion:13}。错误示例：

~~~json
{
  "error": {"code": "VERSION_CONFLICT", "message": "这条任务已被更新，你的输入已保留。", "currentVersion": 5},
  "meta": {"requestId": "req_example"}
}
~~~

这些是说明格式的合成数据，不是已实现或真实测量结果。

## 8. 文件上传协议

POST /tasks/{id}/attachments 使用 multipart/form-data：uploadId（客户端 UUID）、declaredSizeBytes、sha256（客户端计算的内容摘要）、file。客户端按此顺序追加，file最后；服务端在收到文件流前完成元信息校验与配额预留，元信息缺失/顺序不合法返回400。服务端重新计算摘要，不能信任客户端结果。file MIME/名称从 multipart 元数据取得，按上传规则验证。空文件拒绝；单次上传总时限120秒；元信息区最大64KiB。

Attachment 增加 clientUploadId、claimedSha256；UNIQUE(taskId,uploaderId,clientUploadId)。相同 uploadId 同元信息：READY 返回既有附件200，UPLOADING 返回409 UPLOAD_IN_PROGRESS，FAILED/DELETED 返回409并要求新的 uploadId；元信息或内容摘要不同返回409 IDEMPOTENCY_CONFLICT。这样网络超时重传不创建第二个附件。

前端通过 XHR 或支持 upload progress 的客户端获取真实上传进度，不伪造百分比。成功201/重放200返回 AttachmentDTO；列表返回全部UPLOADING/READY及最近5条FAILED供界面恢复，DELETED不返回，因此列表最多10条。下载端点返回 {url,expiresAt,fileName}，先重新鉴权，再按需导航下载。signed URL 不进入持久日志。

## 9. 活动动作

PROJECT_CREATED、PROJECT_UPDATED、PROJECT_ARCHIVED、PROJECT_RESTORED、MEMBER_JOINED、MEMBER_LEFT、MEMBER_REMOVED、TASK_CREATED、TASK_UPDATED、TASK_MOVED、TASK_DELETED、TASK_RESTORED、SUBTASK_CREATED、SUBTASK_UPDATED、SUBTASK_DELETED、COMMENT_CREATED、COMMENT_UPDATED、COMMENT_DELETED、FILE_UPLOADED、FILE_DELETED。

邀请创建/撤销只在邀请列表显示，V1 不额外加入活动枚举；不得记录其 token。重复无变化更新不产生事件。一次用户操作只产生清晰的一条主要事件，成员退出的批量取消分配用 metadata.count 表达。

## 10. 契约验收

- 所有业务 endpoint 的 method/path/operationId 与 OpenAPI 一致。
- 请求/响应通过 schema，错误也有统一结构。
- 业务 JSON payload 最大64KiB（附件接口另设上限），过大请求在完整解析前拒绝。
- 合法/非法输入、权限、409、分页边界和幂等至少覆盖关键接口。
- 文件上传、认证回调和空body204不能误用统一 JSON 解析器。


## 2026-09-11 · M5 协议冲突关闭

附件 uploadId 保持 UUID；内部 DELETED + deletedAt 同步，公开 DTO 不返回 DELETED。下载端点保持 Download JSON，url 为 60 秒有效且绑定当前用户的应用签名链接。GET /attachments/{attachmentId}/content 校验签名、当前会话、当前项目成员、父任务未删除和附件 READY 后代理私有 S3 流，强制 attachment、private,no-store；不向客户端暴露 objectKey。该选择取代先前签名存储 URL 与直接二进制响应混用的实现。

上传先持久预留，再有界流接收至私有临时文件并校验实际内容/大小/摘要、流写 S3，最后独立事务复核权限并提交 READY。请求总时限 120 秒；临时文件请求结束删除。维护命令 cleanup:attachments 处理一小时以上失效上传及 cleanupPending 对象；FAILED/DELETED 的待删标志保留至少 3 分钟，让取消中的 PUT 结束后再物理删除。对象删除失败保留待重试标志，已清理对象不重复释放配额。

### HEAD 读取准入

框架为 GET 路由提供的 HEAD 使用同一会话、授权与生产读取额度（300 次/用户/分钟）；不返回正文。私有文件 content 路由显式返回 405，避免 HEAD 打开对象流。该方法支持说明不新增 JSON 数据结构。
