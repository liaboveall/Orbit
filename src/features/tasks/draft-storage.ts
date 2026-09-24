import { z } from "zod";

/**
 * 任务标题/描述草稿的本机持久化（DRAFT-LOGOUT 修复后的唯一读写入口）。
 *
 * 用途：页面刷新、浏览器崩溃或会话过期后恢复正在编辑的文字（docs/02 草稿规则）。
 * 生命周期：
 *  - 键按用户隔离：`orbit:draft:<userId>:<projectId>:<taskId>`，只保存标题/描述与基准版本；
 *  - 有效期 7 天，过期在读取或应用外壳加载时删除；
 *  - 保存成功、取消、在「保留编辑/放弃更改」中放弃、确认离开页面时删除该任务草稿；
 *  - 成功退出登录删除该用户全部草稿，退出取消/失败保留；
 *  - 应用外壳加载时删除其他账号留下的草稿，共享浏览器换账号不残留上一账号的私有文字；
 *  - 退出项目或失去项目访问时删除该项目草稿。
 * localStorage 不可用（隐私模式、配额）时静默降级为仅内存草稿，绝不阻止编辑。
 */

const PREFIX = "orbit:draft:";

/** 草稿保留期限。 */
export const TASK_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type TaskDraft = { expectedVersion: number; title?: string; description?: string };
export type StoredTaskDraft = TaskDraft & { savedAt: number };

const StoredTaskDraftSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().optional(),
  description: z.string().optional(),
  savedAt: z.number().int().positive(),
});

export function taskDraftKey(userId: string, projectId: string, taskId: string): string {
  return `${PREFIX}${userId}:${projectId}:${taskId}`;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function forget(store: Storage, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    /* Unavailable storage must not prevent editing. */
  }
}

const listeners = new Set<() => void>();
function notify(): void {
  for (const listener of listeners) listener();
}

/** 订阅草稿变化（本页写入 + 其它标签页的 storage 事件），供 useSyncExternalStore 使用。 */
export function subscribeTaskDrafts(callback: () => void): () => void {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

/** 读取原始草稿字符串（稳定原始值，可作为外部存储快照）。 */
export function readTaskDraftRaw(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** 纯解析：格式不合法、没有文字字段或已过期均视为无草稿。 */
export function parseTaskDraft(raw: string | null, now = Date.now()): StoredTaskDraft | null {
  if (raw === null) return null;
  try {
    const parsed = StoredTaskDraftSchema.safeParse(JSON.parse(raw));
    if (
      parsed.success &&
      now - parsed.data.savedAt <= TASK_DRAFT_TTL_MS &&
      (parsed.data.title !== undefined || parsed.data.description !== undefined)
    )
      return parsed.data;
  } catch {
    /* Invalid local draft. */
  }
  return null;
}

/** 读取有效草稿；无效或过期的草稿会被删除并返回 null。 */
export function readTaskDraft(key: string, now = Date.now()): StoredTaskDraft | null {
  const raw = readTaskDraftRaw(key);
  const draft = parseTaskDraft(raw, now);
  if (raw !== null && draft === null) removeTaskDraft(key);
  return draft;
}

export function writeTaskDraft(key: string, draft: TaskDraft, now = Date.now()): void {
  try {
    storage()?.setItem(key, JSON.stringify({ ...draft, savedAt: now }));
  } catch {
    /* Unavailable storage must not prevent editing. */
  }
  notify();
}

export function removeTaskDraft(key: string): void {
  const store = storage();
  if (!store) return;
  forget(store, key);
  notify();
}

/** 删除满足条件的草稿；键格式为 PREFIX + userId:projectId:taskId。 */
function removeDrafts(match: (owner: string, projectId: string, key: string) => boolean): number {
  const store = storage();
  if (!store) return 0;
  const keys: string[] = [];
  try {
    for (let index = 0; index < store.length; index++) {
      const key = store.key(index);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
  } catch {
    return 0;
  }
  let removed = 0;
  for (const key of keys) {
    const [owner = "", projectId = ""] = key.slice(PREFIX.length).split(":");
    if (match(owner, projectId, key)) {
      forget(store, key);
      removed++;
    }
  }
  if (removed > 0) notify();
  return removed;
}

/** 成功退出登录：删除该用户全部草稿。 */
export function clearUserDrafts(userId: string): number {
  return removeDrafts((owner) => owner === userId);
}

/** 退出项目或失去项目访问：删除该项目的全部草稿。 */
export function clearProjectDrafts(projectId: string): number {
  return removeDrafts((_owner, project) => project === projectId);
}

/** 应用外壳加载：删除其他账号的草稿以及当前账号已过期的草稿。 */
export function pruneDrafts(currentUserId: string, now = Date.now()): number {
  return removeDrafts((owner, _project, key) => owner !== currentUserId || parseTaskDraft(readTaskDraftRaw(key), now) === null);
}
