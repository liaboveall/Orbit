import { describe, expect, it } from "vitest";
import type { BoardDTO, TaskDTO, TaskStatus, TaskSummaryDTO } from "@/contracts";
import {
  adoptSnapshot,
  initialBoardState,
  needsRefill,
  placeTask,
  settleTask,
} from "@/features/board/board-state";
import { sameTaskSummary } from "@/features/tasks/task-meta";

/**
 * 看板本地状态的纯函数。重点是两条不变量：
 *  - 比本地还旧的服务端快照不会把刚移动的卡片弹回去；
 *  - 乐观移动与移动成功后的落定只改该改的那张卡片和两列的总数。
 */

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = { id: "user-1", name: "林夏" };

function task(number: number, status: TaskStatus = "TODO", overrides: Partial<TaskSummaryDTO> = {}): TaskSummaryDTO {
  return {
    id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    projectId: PROJECT,
    number,
    identifier: `ORB-${number}`,
    title: `任务 ${number}`,
    status,
    priority: "MEDIUM",
    assignee: null,
    creator: USER,
    dueDate: null,
    completedAt: status === "DONE" ? "2026-11-01T00:00:00.000Z" : null,
    version: 1,
    subtaskTotal: 0,
    subtaskCompleted: 0,
    commentCount: 0,
    attachmentCount: 0,
    deletedAt: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function board(version: number, columns: Partial<Record<TaskStatus, TaskSummaryDTO[]>>, cursors: Partial<Record<TaskStatus, string>> = {}): BoardDTO {
  return {
    boardVersion: version,
    columns: (["TODO", "IN_PROGRESS", "DONE"] as const).map((status) => ({
      status,
      total: columns[status]?.length ?? 0,
      items: columns[status] ?? [],
      nextCursor: cursors[status] ?? null,
    })),
  };
}

const ids = (value: BoardDTO, status: TaskStatus) => value.columns.find((c) => c.status === status)!.items.map((t) => t.number);

describe("adoptSnapshot", () => {
  it("换了筛选或项目：直接用新快照，不保留旧看板", () => {
    const state = initialBoardState(board(3, { TODO: [task(1)] }), "a");
    const next = adoptSnapshot(state, board(1, { TODO: [task(2)] }), "b");
    expect(next.context).toBe("b");
    expect(ids(next.board, "TODO")).toEqual([2]);
    expect(next.stale).toBe(0);
  });

  it("同一视图、版本不低于本地：采用服务端快照", () => {
    const state = initialBoardState(board(3, { TODO: [task(1)] }), "a");
    const snapshot = board(3, { TODO: [task(1, "TODO", { title: "改过的标题" })] });
    const next = adoptSnapshot(state, snapshot, "a");
    expect(next.board).toBe(snapshot);
    expect(next.refill).toBeNull();
  });

  it("比本地还旧的快照不采用：保留本地看板并标记需要再读", () => {
    const local = board(4, { DONE: [task(1, "DONE")] });
    const state = { ...initialBoardState(board(3, { TODO: [task(1)] }), "a"), board: local };
    const stale = board(3, { TODO: [task(1)] });
    const next = adoptSnapshot(state, stale, "a");
    expect(next.board).toBe(local);
    expect(next.source).toBe(stale);
    expect(next.stale).toBe(1);
  });

  it("连续三次都旧：说明本地记错了，放弃本地状态", () => {
    const local = board(9, { DONE: [task(1, "DONE")] });
    let state = { ...initialBoardState(board(3, {}), "a"), board: local };
    state = adoptSnapshot(state, board(3, { TODO: [task(1)] }), "a");
    state = adoptSnapshot(state, board(3, { TODO: [task(1)] }), "a");
    expect(state.stale).toBe(2);
    expect(state.board).toBe(local);
    const server = board(3, { TODO: [task(1)] });
    state = adoptSnapshot(state, server, "a");
    expect(state.board).toBe(server);
    expect(state.stale).toBe(0);
  });

  it("本地已加载更多分页：先保留旧看板，等补读完成", () => {
    const loaded = board(3, { TODO: [task(1), task(2), task(3)] });
    const state = { ...initialBoardState(loaded, "a"), board: loaded };
    const firstPage = board(3, { TODO: [task(1), task(2)] }, { TODO: "cursor" });
    const next = adoptSnapshot(state, firstPage, "a");
    expect(next.board).toBe(loaded);
    expect(next.refill).toBe(loaded);
    expect(next.source).toBe(firstPage);
  });
});

describe("needsRefill", () => {
  it("新快照没有后续页：不需要补读", () => {
    expect(needsRefill(board(1, { TODO: [task(1)] }), board(1, { TODO: [task(1), task(2)] }))).toBe(false);
  });

  it("新快照还有后续页，而本地已全部加载或加载得更多：需要补读", () => {
    const next = board(1, { TODO: [task(1)] }, { TODO: "cursor" });
    expect(needsRefill(next, board(1, { TODO: [task(1), task(2)] }))).toBe(true);
    expect(needsRefill(next, board(1, { TODO: [task(1), task(2)] }, { TODO: "older" }))).toBe(true);
  });

  it("本地也只读了这么多：不需要补读", () => {
    const next = board(1, { TODO: [task(1)] }, { TODO: "cursor" });
    expect(needsRefill(next, board(1, { TODO: [task(9)] }, { TODO: "older" }))).toBe(false);
  });
});

describe("placeTask", () => {
  const start = board(1, { TODO: [task(1), task(2), task(3)], DONE: [task(4, "DONE")] });

  it("跨列放到列尾：两列总数各变一，任务带上新状态", () => {
    const moved = placeTask(start, task(2), "DONE", null);
    expect(ids(moved, "TODO")).toEqual([1, 3]);
    expect(ids(moved, "DONE")).toEqual([4, 2]);
    expect(moved.columns.map((c) => c.total)).toEqual([2, 0, 2]);
    expect(moved.columns[2]!.items[1]!.status).toBe("DONE");
  });

  it("跨列插到指定任务之前", () => {
    const moved = placeTask(start, task(2), "DONE", task(4, "DONE").id);
    expect(ids(moved, "DONE")).toEqual([2, 4]);
  });

  it("同列重排：总数不变", () => {
    const moved = placeTask(start, task(3), "TODO", task(1).id);
    expect(ids(moved, "TODO")).toEqual([3, 1, 2]);
    expect(moved.columns[0]!.total).toBe(3);
  });

  it("不修改传入的看板", () => {
    placeTask(start, task(2), "DONE", null);
    expect(ids(start, "TODO")).toEqual([1, 2, 3]);
    expect(start.columns[0]!.total).toBe(3);
  });
});

describe("settleTask", () => {
  it("用服务端返回的任务替换那一张并记下新的看板版本，描述不进看板", () => {
    const placed = placeTask(board(1, { TODO: [task(1), task(2)] }), task(2), "DONE", null);
    const saved: TaskDTO = { ...task(2, "DONE", { version: 2, completedAt: "2026-11-15T08:00:00.000Z" }), description: "很长的描述" };
    const settled = settleTask(placed, saved, 2);
    expect(settled.boardVersion).toBe(2);
    const card = settled.columns[2]!.items[0]!;
    expect(card.version).toBe(2);
    expect(card.completedAt).toBe("2026-11-15T08:00:00.000Z");
    expect("description" in card).toBe(false);
    expect(ids(settled, "TODO")).toEqual([1]);
  });
});

describe("sameTaskSummary", () => {
  it("内容相同的新对象视为同一份（后台刷新不重渲染卡片）", () => {
    expect(sameTaskSummary(task(1), task(1))).toBe(true);
    expect(sameTaskSummary(task(1, "TODO", { assignee: USER }), task(1, "TODO", { assignee: { ...USER } }))).toBe(true);
  });

  it("任何显示在卡片上的字段变化都算不同", () => {
    const base = task(1);
    const changes: Partial<TaskSummaryDTO>[] = [
      { title: "新标题" },
      { status: "DONE" },
      { priority: "HIGH" },
      { dueDate: "2026-11-20" },
      { version: 2 },
      { updatedAt: "2026-11-02T00:00:00.000Z" },
      { assignee: USER },
      { subtaskTotal: 2 },
      { subtaskCompleted: 1 },
      { commentCount: 3 },
      { attachmentCount: 1 },
    ];
    for (const change of changes) expect(sameTaskSummary(base, { ...base, ...change }), JSON.stringify(change)).toBe(false);
  });

  it("负责人改名（版本不变）也算不同", () => {
    const base = task(1, "TODO", { assignee: USER });
    expect(sameTaskSummary(base, { ...base, assignee: { id: USER.id, name: "林夏夏" } })).toBe(false);
  });
});
