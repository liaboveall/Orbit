/**
 * Conflict Handler Utilities (ORB-012)
 *
 * 客户端乐观并发冲突处理的**纯逻辑工具**：草稿本地暂存 + 冲突码判定。
 *
 * 设计约束（单一数据真源 + 无第二套请求/缓存实现）：
 *  - 本模块**不发请求、不弹 toast、不管理缓存**。真实写操作由调用方（详情编辑组件）
 *    通过 `createApiClient().patch(...)` 完成，返回统一的 `ApiResult`；
 *  - toast 由调用方使用 `@/components/ui/toast` 的 `useToast`（Provider 已在 AppProviders 挂载）；
 *  - 409 冲突时，调用方保留用户草稿（`DraftManager.save`）并提示「已被他人更新」，
 *    再通过 `router.refresh()` 拉取服务器最新版本。
 *
 * 因此这里只保留可被单测覆盖、且被真实组件调用的纯函数与本地存储工具。
 */

import type { ErrorDetail } from "@/contracts/envelope";

/**
 * 草稿本地暂存工具（localStorage）。
 *
 * 用于「保存请求失败/版本冲突」时保留用户未提交的编辑内容，避免刷新丢失。
 * 键前缀 `orbit_draft_`，与单测 `tests/unit/conflict-handler.test.ts` 契约一致。
 */
export class DraftManager {
  private static STORAGE_KEY_PREFIX = "orbit_draft_";

  /** 保存草稿到 localStorage。 */
  static save(taskId: string, data: unknown): void {
    try {
      const key = `${this.STORAGE_KEY_PREFIX}${taskId}`;
      localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      // localStorage 不可用（隐私模式/配额）时静默失败，不影响主流程。
      console.warn("Failed to save draft:", error);
    }
  }

  /** 从 localStorage 读取草稿；不存在或非法 JSON 时返回 null。 */
  static load(taskId: string): unknown | null {
    try {
      const key = `${this.STORAGE_KEY_PREFIX}${taskId}`;
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  /** 清除指定任务的草稿。 */
  static clear(taskId: string): void {
    try {
      const key = `${this.STORAGE_KEY_PREFIX}${taskId}`;
      localStorage.removeItem(key);
    } catch {
      // 忽略错误
    }
  }

  /** 清除属于指定项目的全部草稿（依据草稿载荷中的 projectId 字段）。 */
  static clearProject(projectId: string): void {
    try {
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith(this.STORAGE_KEY_PREFIX)) {
          const data = JSON.parse(localStorage.getItem(key) || "{}");
          if ((data as { projectId?: string }).projectId === projectId) {
            localStorage.removeItem(key);
          }
        }
      });
    } catch {
      // 忽略错误
    }
  }
}

/**
 * 判定统一错误信封是否为「乐观并发冲突」（VERSION_CONFLICT / BOARD_CONFLICT）。
 *
 * 调用方拿到 `ApiResult`（`result.ok === false` 时 `result.error` 为 `ErrorDetail`），
 * 传入 `result.error` 即可判定。冲突时应保留草稿并刷新服务器最新版本。
 */
export function isVersionConflict(error: ErrorDetail | undefined | null): boolean {
  if (!error) return false;
  return error.code === "VERSION_CONFLICT" || error.code === "BOARD_CONFLICT";
}

/**
 * 版本号是否一致（乐观更新前置校验的纯函数）。
 */
export function isVersionMatch(currentVersion: number, expectedVersion: number): boolean {
  return currentVersion === expectedVersion;
}
