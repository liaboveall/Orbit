import { z } from "zod";

/**
 * 契约层共享的「基础字段」schema（ORB-003）。
 *
 * 这些原子 schema 直接对齐 contracts/openapi.json 中反复出现的字段约束，
 * 供 envelope.ts / dto.ts 复用，保证同一字段在所有 DTO 中约束一致。
 *
 * 约定（docs/05 §2）：
 *  - JSON camelCase；日期时间 UTC ISO 8601；date-only 为 YYYY-MM-DD。
 *  - 业务 ID 是 UUID；userId 是认证库字符串 ID（1–128）。
 *
 * 本模块无任何服务端依赖，可进入客户端 bundle（docs/03 §3）。
 */

/** meta.requestId：string(1–128)，对齐 Meta.requestId。 */
export const RequestIdSchema = z.string().min(1).max(128);

/** 不透明分页游标：string(1–2048)，对齐 PageMeta.nextCursor / cursor 查询参数。 */
export const CursorSchema = z.string().min(1).max(2048);

/** 业务实体 ID：UUID（Project/Task/Subtask/Comment/Attachment/Activity 的 id）。 */
export const UuidSchema = z.uuid();

/** 认证库字符串用户 ID：string(1–128)（User.id / ownerId / userId / assigneeId 等）。 */
export const UserIdSchema = z.string().min(1).max(128);

/**
 * UTC ISO 8601 日期时间（format: date-time）。
 * 使用 Zod 4 的 `z.iso.datetime()`；允许时区偏移以兼容真实序列化结果。
 */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

/** date-only（format: date，YYYY-MM-DD），用于 dueDate / Overview.today。 */
export const IsoDateSchema = z.iso.date();

/** 合理日期年份范围：1900-2100（产品决策，防止极端值导致数据库/序列化错误）。 */
const DATE_MIN_YEAR = 1900;
const DATE_MAX_YEAR = 2100;

/**
 * 严格的 date-only 校验（YYYY-MM-DD），用于 dueDate 写入校验。
 *
 * 三重校验（修复审查 R9）：
 *  1. 格式必须精确匹配 YYYY-MM-DD（拒绝带时分秒、非法分隔符、空格）；
 *  2. 年份必须在 1900–2100 范围内；
 *  3. 必须是真实日历日（round-trip 校验，拒绝 2026-02-30 这类
 *     `new Date()` 会静默归一化为 3 月的伪日期——归一化后范围检查通过，
 *     却在业务层抛 RangeError→500）。
 *
 * 无效日期统一在契约层返回 400 VALIDATION_ERROR，不进入业务事务。
 * 本 schema 仅依赖 zod，属契约层自包含，不引入 @/lib 跨层依赖（修复审查 R1）。
 */
export const DueDateSchema = z.string().superRefine((value, ctx) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    ctx.addIssue({ code: "custom", message: "日期格式必须为 YYYY-MM-DD" });
    return;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < DATE_MIN_YEAR || year > DATE_MAX_YEAR) {
    ctx.addIssue({
      code: "custom",
      message: `日期必须在 ${DATE_MIN_YEAR} 年至 ${DATE_MAX_YEAR} 年之间`,
    });
    return;
  }

  // 真实日历日 round-trip 校验：用 UTC 构造后比对年月日是否一致。
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    ctx.addIssue({ code: "custom", message: "日期不是有效的日历日" });
  }
});


/** 乐观并发版本号：integer ≥ 1（version / expectedVersion / boardVersion）。 */
export const VersionSchema = z.number().int().min(1);

/** 可空日期时间：`anyOf[date-time, null]`（archivedAt / completedAt / deletedAt 等）。 */
export const NullableIsoDateTimeSchema = IsoDateTimeSchema.nullable();
