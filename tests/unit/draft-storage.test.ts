import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TASK_DRAFT_TTL_MS,
  clearProjectDrafts,
  clearUserDrafts,
  parseTaskDraft,
  pruneDrafts,
  readTaskDraft,
  readTaskDraftRaw,
  removeTaskDraft,
  subscribeTaskDrafts,
  taskDraftKey,
  writeTaskDraft,
} from "@/features/tasks/draft-storage";
import { PENDING_INVITE_TTL_MS, forgetInviteToken, recallInviteToken, rememberInviteToken } from "@/features/invitations/pending-invite";

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() { return this.items.size; }
  clear() { this.items.clear(); }
  getItem(key: string) { return this.items.get(key) ?? null; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  removeItem(key: string) { this.items.delete(key); }
  setItem(key: string, value: string) { this.items.set(key, String(value)); }
}

const scope = globalThis as unknown as { window?: unknown; sessionStorage?: Storage };
let local: MemoryStorage;

beforeEach(() => {
  local = new MemoryStorage();
  scope.window = { localStorage: local, addEventListener: () => undefined, removeEventListener: () => undefined };
  scope.sessionStorage = new MemoryStorage();
});
afterEach(() => {
  delete scope.window;
  delete scope.sessionStorage;
});

const now = Date.UTC(2026, 8, 24, 8);
const key = (user: string, project: string, task: string) => taskDraftKey(user, project, task);

describe("任务草稿本机持久化", () => {
  it("写入带保存时间，读取往返一致", () => {
    writeTaskDraft(key("u1", "p1", "t1"), { expectedVersion: 3, description: "草稿" }, now);
    expect(readTaskDraft(key("u1", "p1", "t1"), now)).toEqual({ expectedVersion: 3, description: "草稿", savedAt: now });
  });

  it("过期、缺少文字字段、旧格式或损坏的草稿视为无草稿并被删除", () => {
    writeTaskDraft(key("u1", "p1", "old"), { expectedVersion: 1, title: "旧" }, now - TASK_DRAFT_TTL_MS - 1);
    writeTaskDraft(key("u1", "p1", "empty"), { expectedVersion: 1 }, now);
    local.setItem(key("u1", "p1", "legacy"), JSON.stringify({ expectedVersion: 1, title: "无时间" }));
    local.setItem(key("u1", "p1", "broken"), "{");
    for (const task of ["old", "empty", "legacy", "broken"]) {
      expect(readTaskDraft(key("u1", "p1", task), now)).toBeNull();
      expect(readTaskDraftRaw(key("u1", "p1", task))).toBeNull();
    }
    expect(parseTaskDraft(null)).toBeNull();
  });

  it("成功退出只删除该用户的草稿，不误删其他来源的存储", () => {
    writeTaskDraft(key("u1", "p1", "t1"), { expectedVersion: 1, title: "A" }, now);
    writeTaskDraft(key("u2", "p1", "t1"), { expectedVersion: 1, title: "B" }, now);
    local.setItem("orbit_other_setting", "keep");
    expect(clearUserDrafts("u1")).toBe(1);
    expect(readTaskDraftRaw(key("u1", "p1", "t1"))).toBeNull();
    expect(readTaskDraftRaw(key("u2", "p1", "t1"))).not.toBeNull();
    expect(local.getItem("orbit_other_setting")).toBe("keep");
  });

  it("外壳加载删除其他账号与已过期草稿，保留当前账号的有效草稿", () => {
    writeTaskDraft(key("current", "p1", "valid"), { expectedVersion: 1, title: "保留" }, now);
    writeTaskDraft(key("current", "p1", "expired"), { expectedVersion: 1, title: "过期" }, now - TASK_DRAFT_TTL_MS - 1);
    writeTaskDraft(key("previous", "p1", "t1"), { expectedVersion: 1, description: "上一账号的私有文字" }, now);
    expect(pruneDrafts("current", now)).toBe(2);
    expect(readTaskDraftRaw(key("current", "p1", "valid"))).not.toBeNull();
    expect(readTaskDraftRaw(key("current", "p1", "expired"))).toBeNull();
    expect(readTaskDraftRaw(key("previous", "p1", "t1"))).toBeNull();
  });

  it("失去项目访问只删除该项目的草稿", () => {
    writeTaskDraft(key("u1", "gone", "t1"), { expectedVersion: 1, title: "A" }, now);
    writeTaskDraft(key("u1", "kept", "t1"), { expectedVersion: 1, title: "B" }, now);
    expect(clearProjectDrafts("gone")).toBe(1);
    expect(readTaskDraftRaw(key("u1", "kept", "t1"))).not.toBeNull();
  });

  it("写入与删除通知订阅者（编辑器据此同步本机草稿提示）", () => {
    let calls = 0;
    const unsubscribe = subscribeTaskDrafts(() => { calls++; });
    writeTaskDraft(key("u1", "p1", "t1"), { expectedVersion: 1, title: "A" }, now);
    removeTaskDraft(key("u1", "p1", "t1"));
    unsubscribe();
    writeTaskDraft(key("u1", "p1", "t2"), { expectedVersion: 1, title: "B" }, now);
    expect(calls).toBe(2);
  });

  it("存储不可用时静默降级", () => {
    delete scope.window;
    expect(() => writeTaskDraft(key("u1", "p1", "t1"), { expectedVersion: 1, title: "A" }, now)).not.toThrow();
    expect(readTaskDraft(key("u1", "p1", "t1"), now)).toBeNull();
    expect(clearUserDrafts("u1")).toBe(0);
  });
});

describe("待接受邀请令牌的标签页暂存", () => {
  it("30 分钟内可取回，超时或损坏即删除", () => {
    rememberInviteToken("token-a", now);
    expect(recallInviteToken(now + PENDING_INVITE_TTL_MS)).toBe("token-a");
    expect(recallInviteToken(now + PENDING_INVITE_TTL_MS + 1)).toBeNull();
    expect(scope.sessionStorage!.getItem("inviteToken")).toBeNull();
    scope.sessionStorage!.setItem("inviteToken", "legacy-plain-token");
    expect(recallInviteToken(now)).toBeNull();
    expect(scope.sessionStorage!.getItem("inviteToken")).toBeNull();
  });

  it("终态失效或接受后删除", () => {
    rememberInviteToken("token-b", now);
    forgetInviteToken();
    expect(recallInviteToken(now)).toBeNull();
  });
});
