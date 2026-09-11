import "server-only";

/**
 * 项目授权**纯判定**函数（M2 / ORB-007，docs/01 §4 权限矩阵、docs/03 §5）。
 *
 * 设计原则：把「谁能访问 / 谁能写」的决策抽成无 IO 的纯函数，便于 unit 测试穷举分支，
 * 也便于事务内（project-access.ts）在持锁后复用同一套判定，杜绝判定逻辑与 IO 纠缠。
 *
 * 关键取舍（docs/03 §5、docs/05 §3）：**非成员与不存在统一收敛为 NOT_FOUND**，
 * 不向未授权者泄露「项目是否存在」。
 */

/** 计算得到的项目角色（不写库，docs/05 §4）。 */
export type ProjectRole = "OWNER" | "MEMBER";

/** decideProjectAccess 的输入事实（由 IO 层查库后填充）。 */
export interface ProjectAccessFacts {
  /** 项目行是否存在。 */
  exists: boolean;
  /** 当前用户是否为 owner（Project.ownerId === userId）。 */
  isOwner: boolean;
  /** 当前用户是否在 ProjectMember 中（非 owner 成员）。 */
  isMember: boolean;
}

/**
 * 判定读访问角色：
 *  - 项目不存在 → NOT_FOUND；
 *  - owner → "OWNER"；
 *  - 成员 → "MEMBER"；
 *  - 既非 owner 也非成员 → NOT_FOUND（不区分不存在与不可见）。
 */
export function decideProjectAccess(facts: ProjectAccessFacts): ProjectRole | "NOT_FOUND" {
  if (!facts.exists) return "NOT_FOUND";
  if (facts.isOwner) return "OWNER";
  if (facts.isMember) return "MEMBER";
  return "NOT_FOUND";
}

/** 项目级写操作类型（均为 owner-only，docs/01 §4 权限矩阵）。 */
export type ProjectWriteAction = "update" | "archive" | "restore";

/** decideProjectWrite 的判定结果。 */
export type ProjectWriteDecision = "ALLOWED" | "FORBIDDEN" | "ARCHIVED";

/** decideProjectWrite 的输入。 */
export interface ProjectWriteFacts {
  role: ProjectRole;
  archivedAt: Date | null;
  action: ProjectWriteAction;
}

/**
 * 判定写访问：
 *  - 仅 owner 可修改/归档/恢复项目；member → FORBIDDEN；
 *  - 归档项目对写操作只读 → ARCHIVED，**唯一例外**是 owner 的 restore；
 *  - 其余 → ALLOWED。
 *
 * 注：调用方须先经 decideProjectAccess 确认 role（非成员根本到不了这里）。
 */
export function decideProjectWrite(facts: ProjectWriteFacts): ProjectWriteDecision {
  if (facts.role !== "OWNER") return "FORBIDDEN";
  const isArchived = facts.archivedAt !== null;
  if (isArchived && facts.action !== "restore") return "ARCHIVED";
  return "ALLOWED";
}
