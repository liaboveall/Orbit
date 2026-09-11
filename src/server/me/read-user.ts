import "server-only";
import { UserSchema, type UserDTO } from "@/contracts";
import type { User } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import { DomainError } from "@/server/http/errors";
import { registrationTimezone } from "@/server/auth/user-fields";

/**
 * 当前账户读取服务（M1 / ORB-006）。
 *
 * 为什么**直接查库**而不复用 Better Auth 的 `getSession().user`：
 *  - 会话对象可能来自库内缓存/快照，PATCH /me 之后 GET /me 必须立刻读到新值
 *    （验收标准 #1「修改刷新后保留」的关键）；直接 `findUnique` 是唯一可靠来源。
 *  - 会话检查（身份/权限）仍由 `requireSessionUser` 完成，本模块只负责按已认证的
 *    userId 取权威档案，二者职责不混（docs/03 §4 请求生命周期）。
 *
 * 安全：出库前一律经契约 `UserSchema` 复校 —— 只暴露白名单字段，
 * 绝不返回认证表原始记录（docs/04 §3：业务 API 永不返回这些表的原始记录）。
 */

/** 映射所需的 User 列（显式 Pick，避免把 image/createdAt 等无关列带进 DTO 构造）。 */
export type UserRow = Pick<User, "id" | "name" | "email" | "emailVerified"> & {
  timezone?: string | null;
};

/** 账户不存在（会话有效但用户行已被删除）时的统一领域错误。 */
export function accountNotFoundError(): DomainError {
  return new DomainError("NOT_FOUND", "账户不存在或已被删除，请重新登录。");
}

/** 数据库行 → 契约 UserDTO（经 UserSchema 复校，非法形状直接抛出而非静默降级）。 */
export function toUserDto(row: UserRow): UserDTO {
  return UserSchema.parse({
    id: row.id,
    // 兼容此前已落库的异常资料：提供可编辑的显示值，不改写原始记录，
    // 更不将真实有效会话判为未认证。用户可通过设置页显式修正。
    name: row.name.trim().slice(0, 40) || "未设置姓名",
    email: row.email,
    emailVerified: row.emailVerified,
    timezone: registrationTimezone(row.timezone),
  });
}

/** 按 id 读取当前账户档案；不存在抛 404 NOT_FOUND（由 HTTP 层统一映射信封）。 */
export async function readUserById(userId: string): Promise<UserDTO> {
  const row = await prisma.user.findUnique({ where: { id: userId } });
  if (!row) throw accountNotFoundError();
  return toUserDto(row);
}
