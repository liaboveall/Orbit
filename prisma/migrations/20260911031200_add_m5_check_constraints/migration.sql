-- M5 CHECK 约束 + 复合 FK（docs/04 §3/§6/§7）。
-- Prisma schema 无法表达这些约束，按项目惯例手写补齐。

-- 跨项目关联防护（docs/04 §3 Attachment）：Attachment 冗余存了 projectId，必须恒等于
-- 父 task.projectId。借助 Task 上既有的 UNIQUE(id, projectId) 加一条复合 FK，
-- 从数据库层面杜绝「附件挂到别的项目」的越权写入。
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_taskId_projectId_fkey"
  FOREIGN KEY ("taskId", "projectId") REFERENCES "Task"("id", "projectId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Subtask CHECK（docs/04 §3）。
-- version 为正：乐观并发版本号 >= 1。
ALTER TABLE "Subtask" ADD CONSTRAINT "Subtask_version_positive_check" CHECK ("version" > 0);
-- 标题 trim 后非空：拒绝全空白标题（与契约 min(1) + 服务端 trim 一致）。
ALTER TABLE "Subtask" ADD CONSTRAINT "Subtask_title_not_blank_check" CHECK (btrim("title") <> '');

-- Comment CHECK（docs/04 §3）。
-- version 为正。
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_version_positive_check" CHECK ("version" > 0);
-- 正文长度上限 2000（与契约 CommentSchema.body max(2000) 一致）。
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_body_length_check" CHECK (char_length("body") <= 2000);
-- 删除语义强一致：未删除 ⇒ 正文 trim 后非空；已删除 ⇒ 正文已清空为 ''（保留 authorId/时间戳
-- 作为占位，GET 侧映射为 body=null + isDeleted=true）。杜绝「已删除但正文仍在库」的泄漏。
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_deleted_body_check" CHECK (
  ("deletedAt" IS NULL AND btrim("body") <> '') OR ("deletedAt" IS NOT NULL AND "body" = '')
);

-- Attachment CHECK（docs/04 §3/§6、docs/01 §8）。
-- 声明大小必须在 1 B — 10 MiB（空文件拒绝；上界与契约 AttachmentSizeSchema 一致）。
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_declared_size_check"
  CHECK ("declaredSizeBytes" > 0 AND "declaredSizeBytes" <= 10485760);
-- 实际大小若已测得，同样受上下界约束。
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_actual_size_check"
  CHECK ("sizeBytes" IS NULL OR ("sizeBytes" > 0 AND "sizeBytes" <= 10485760));
-- READY 要求 sizeBytes 与 sha256 均已落定（docs/04 §3）：杜绝「可下载但未校验」的中间态。
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_ready_verified_check" CHECK (
  "state" <> 'READY' OR ("sizeBytes" IS NOT NULL AND "sha256" IS NOT NULL)
);
-- DELETED 当且仅当 deletedAt 非空：状态机与删除时刻强一致（FAILED 不等于已删除）。
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_deleted_state_check"
  CHECK (("state" = 'DELETED') = ("deletedAt" IS NOT NULL));
-- 摘要必须是小写十六进制 SHA-256：claimedSha256 为客户端声明，sha256 为服务端实测。
-- 统一大小写形态，避免「同一文件两种写法」绕过比对。
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_claimed_sha256_hex_check"
  CHECK ("claimedSha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_sha256_hex_check"
  CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$');
-- 原始文件名 trim 后非空（仅用于下载时回显，不参与 objectKey 生成）。
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_original_name_not_blank_check"
  CHECK (btrim("originalName") <> '');
-- objectKey trim 后非空：服务端生成的存储键不允许为空串。
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_object_key_not_blank_check"
  CHECK (btrim("objectKey") <> '');
