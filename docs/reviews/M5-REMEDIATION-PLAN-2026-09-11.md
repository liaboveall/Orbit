# M5 全量修复约定

范围是 M5-DEEP-REVIEW 的 R01–R19，不提前实现 M6/M7。

规范冲突处理：uploadId 保持产品/OpenAPI 已规定的 UUID，撤回未应用的 varchar 草案，保留已应用迁移不可变。附件内部继续使用 DELETED + deletedAt（数据库 CHECK 已存在），DTO 只暴露 UPLOADING/READY/FAILED。

下载保留原 Download JSON 协议，但签名 URL 指向应用私有 content 端点，由应用校验 60 秒 HMAC、当前登录者和当前成员/任务状态后流式代理 S3。这样不将 objectKey 放入客户端 URL。同步产品、数据、API 与 OpenAPI；新增 content 只用于下载，不提供在线预览。

上传依次进行元信息校验、锁内持久预留、有界流接收至私有临时文件及摘要/格式验证、流式写私有 S3、锁内复核与 READY 提交。无数据库长事务包裹网络操作。失败留下 FAILED/cleanupPending 记录；维护脚本处理超时 UPLOADING 及待删对象，失败可重试。临时文件每次请求结束删除。

所有 R 项须以正式测试和真实数据库/MinIO 联调关闭；现有测试不得通过禁用检查或扩大权限修绿。新测试只允许独立测试库、精确夹具清理。

后续验收发现并纳入修复：评论分页 HTTP 信封、子资源幂等键 UUID 校验、Prisma 复合外键遗漏、旧迁移连接持锁、上传预取消挂起、缺失 MIME 的文件部件、晚到刷新响应和取消 PUT 的清理等待期。最终状态与逐项证据见 M5 修复关闭报告；本约定不代替实际测试记录。
