import "server-only";

/**
 * 业务常量（M2 共享基础设施）。
 *
 * 集中定义配额与算法常量，供领域服务在**锁内**判断（AGENTS.md、docs/04 §6：
 * 上限必须在服务端事务锁内计数校验，不能只靠前端隐藏按钮）。
 * 权威来源：docs/01（产品配额）与 docs/04（数据/看板算法）。
 */

/** 每用户最多未归档项目数（docs/01 §4）。 */
export const MAX_ACTIVE_PROJECTS = 10;

/**
 * 每项目最多成员数（含 owner，docs/01 §4）。
 *
 * M2 尚未提供成员增删端点（仅创建项目时自动写入 owner 一条成员），
 * 故此配额在 M2 不会被触发；自 M4（ORB-014，成员邀请/移除）起在锁内生效。
 */
export const MAX_PROJECT_MEMBERS = 20;

/** 每项目最多未删除任务数（docs/01 §6）。 */
export const MAX_OPEN_TASKS = 1000;

/** 看板 position 初始间隔（docs/04 §5）；用 bigint 以匹配 position 列类型。 */
export const POSITION_GAP = 1024n;

/* ── M5 子资源配额（docs/01 §8）─────────────────────────────────────────── */

/** 每任务最多未删除子任务数（docs/01 §8）。 */
export const MAX_SUBTASKS_PER_TASK = 50;

/** 每任务最多未删除评论数（docs/01 §8）。 */
export const MAX_COMMENTS_PER_TASK = 1000;

/**
 * 每任务最多**有效**附件数（docs/01 §8）。
 * 「有效」= state ∈ {UPLOADING, READY}；FAILED/DELETED 不占额度，
 * 故失败上传不会永久占坑（与 docs/05 §8 的重试语义一致）。
 */
export const MAX_ACTIVE_ATTACHMENTS_PER_TASK = 5;

/** 单个附件最大字节数：10 MiB（docs/01 §8、契约 AttachmentSizeSchema 上界）。 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * 每项目存储预算：200 MiB（docs/01 §8、docs/04 §6）。
 * 预算条件 usedBytes + reservedBytes + declaredSizeBytes <= 此值，锁内判定。
 * 用 bigint 以匹配 Project.usedBytes/reservedBytes 列类型，避免精度损失。
 */
export const MAX_PROJECT_STORAGE_BYTES = 200n * 1024n * 1024n;
