import "server-only";
import type { UpdateMeDTO, UserDTO } from "@/contracts";
import { prisma } from "@/server/db/prisma";
import { DomainError } from "@/server/http/errors";
import { accountNotFoundError, toUserDto } from "./read-user";
import { TIMEZONE_INVALID_MESSAGE, normalizeTimezone } from "./timezone";
import { requireUserNameRejectedReason } from "@/server/auth/user-fields";

/**
 * 当前账户更新服务（M1 / ORB-006）：PATCH /me 的领域逻辑。
 *
 * 规则来源：
 *  - docs/01 §3：姓名 1—40 字符；用户可修改姓名与 IANA 时区；V1 不支持修改邮箱、
 *    账户删除或社交登录 → **字段白名单只有 name / timezone**。
 *  - docs/04 §3：User.timezone 存 IANA 标识；服务端验证时区。
 *  - AGENTS.md：所有资源在服务端校验会话与写权限；外部输入统一运行时 schema 校验
 *    （形状校验在 route 层用契约 UpdateMeSchema 完成，本层负责业务不变量）。
 *
 * 此业务入口直接写入白名单列，并返回统一契约；Better Auth 入口另由数据库钩子校验。
 *
 * 错误码：非法时区/姓名复用契约既有 VALIDATION_ERROR(400) + fieldErrors，不新增 code。
 */

/**
 * PATCH /me 的可写列白名单。
 *
 * 白名单由「显式逐字段构造 + 契约 UpdateMeSchema 的 strict（additionalProperties:false）」
 * 双重保证：即便请求体夹带 email/emailVerified/id 等字段，也先被 schema 拒绝，
 * 再在此处只挑选 name/timezone 两列进入 Prisma update data。
 */
export type UserUpdateData = { name?: string; timezone?: string };

/** Prisma「记录不存在」错误码（P2025）：并发删除时收敛为 404，不外泄数据库细节。 */
function isRecordNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (!("code" in error)) return false;
  return String(error.code) === "P2025";
}

/** 构造 400 VALIDATION_ERROR 领域错误（携带字段级提示，HTTP 层映射为 fieldErrors）。 */
function validationError(fieldErrors: Record<string, string[]>): DomainError {
  return new DomainError("VALIDATION_ERROR", "请求校验未通过，请检查输入后重试。", fieldErrors);
}

/**
 * 归一化并校验待写入字段，返回 Prisma update data。
 *
 * 姓名：去除首尾空白后必须为 1—40 字符（避免 "   " 通过 min(1) 却显示为空白名）。
 * 时区：归一化为 ICU 规范形式（拒裸偏移、大小写/别名归一）后入库，存规范值而非原始输入。
 * 未提供（undefined）的字段不参与写入 —— PATCH 语义为部分更新。
 */
export function buildUserUpdateData(updates: UpdateMeDTO): UserUpdateData {
  const fieldErrors: Record<string, string[]> = {};
  const data: UserUpdateData = {};

  if (updates.name !== undefined) {
    const name = updates.name.trim();
    if (name.length < 1) {
      fieldErrors.name = ["姓名不能为空"];
    } else if (name.length > 40) {
      fieldErrors.name = ["姓名不能超过 40 个字符"];
    } else {
      // F09：与注册入口一致，拒绝 bidi 覆盖/控制字符（规则同 requireUserName）。
      const rejection = requireUserNameRejectedReason(name);
      if (rejection) {
        fieldErrors.name = [rejection];
      } else {
        data.name = name;
      }
    }
  }

  if (updates.timezone !== undefined) {
    const normalized = normalizeTimezone(updates.timezone);
    if (!normalized) {
      fieldErrors.timezone = [TIMEZONE_INVALID_MESSAGE];
    } else {
      // 存归一化后的规范值（例如 `asia/shanghai` → `Asia/Shanghai`），而非用户原始输入。
      data.timezone = normalized;
    }
  }

  if (Object.keys(fieldErrors).length > 0) throw validationError(fieldErrors);
  if (data.name === undefined && data.timezone === undefined) {
    // 形状层已有 minProperties:1 兜底，此处防御「只提供了非法空值」的极端组合。
    throw validationError({ name: ["至少提供一个可修改字段"] });
  }
  return data;
}

/**
 * 更新当前账户（姓名 / 时区），返回更新后的权威 UserDTO。
 *
 * @param userId 已由会话校验确认的当前用户 id（绝不接受来自请求体的 userId）。
 * @param updates 已通过契约 UpdateMeSchema 形状校验的请求体。
 */
export async function updateCurrentUser(
  userId: string,
  updates: UpdateMeDTO,
): Promise<UserDTO> {
  const data = buildUserUpdateData(updates);
  try {
    const row = await prisma.user.update({ where: { id: userId }, data });
    return toUserDto(row);
  } catch (error) {
    if (isRecordNotFound(error)) throw accountNotFoundError();
    throw error;
  }
}
