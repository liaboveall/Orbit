import type { BoardDTO, TaskDTO, TaskStatus, TaskSummaryDTO } from "@/contracts";

/**
 * 看板本地状态的纯函数：采用服务端快照、乐观移动、移动成功后的落定。
 * 没有 React 和网络依赖，单元测试直接覆盖（tests/unit/board-state.test.ts）。
 */

/**
 * 看板的本地状态。
 *  - source：最近一次采用（或判定为过期）的服务端快照，用来识别新的 props；
 *  - board：正在显示的看板，可能领先于 source（乐观移动、已加载的更多分页）；
 *  - refill：非空表示新快照已到，但要先把分页补读到这份旧看板的长度，期间继续显示旧看板；
 *  - stale：连续收到比本地还旧的快照的次数，大于 0 时需要再刷新一次。
 */
export type BoardState = {
  source: BoardDTO;
  context: string;
  board: BoardDTO;
  refill: BoardDTO | null;
  stale: number;
};

export function initialBoardState(initial: BoardDTO, context: string): BoardState {
  return { source: initial, context, board: initial, refill: null, stale: 0 };
}

/** 新快照是否要先补读分页，才能保持刷新前每一列已加载的长度。 */
export function needsRefill(next: BoardDTO, previous: BoardDTO): boolean {
  return previous.columns.some((old) => {
    const column = next.columns.find((c) => c.status === old.status);
    return Boolean(column?.nextCursor) && (old.nextCursor === null || column!.items.length < old.items.length);
  });
}

/**
 * 收到新的服务端快照后，下一个本地状态。
 *
 * boardVersion 只增不减。比本地还旧的快照是在刚完成的移动提交之前读的，采用它会把卡片
 * 弹回去，所以保留本地看板并标记需要再读一次；连续三次都旧，说明本地记错了，放弃本地状态。
 */
export function adoptSnapshot(previous: BoardState, initial: BoardDTO, context: string): BoardState {
  // 换了项目、日期或筛选：旧看板不再适用。
  if (previous.context !== context) return initialBoardState(initial, context);
  if (initial.boardVersion < previous.board.boardVersion && previous.stale < 2) {
    return { ...previous, source: initial, stale: previous.stale + 1 };
  }
  if (needsRefill(initial, previous.board)) return { ...previous, source: initial, refill: previous.board, stale: 0 };
  return initialBoardState(initial, context);
}

/** 把任务放到目标列的指定任务之前（before 为 null 时放到列尾），并修正两列的总数。 */
export function placeTask(board: BoardDTO, task: TaskSummaryDTO, status: TaskStatus, before: string | null): BoardDTO {
  const columns = board.columns.map((c) => ({
    ...c,
    items: c.items.filter((t) => t.id !== task.id),
    total: c.total - (c.status === task.status ? 1 : 0),
  }));
  const target = columns.find((c) => c.status === status);
  if (target) {
    const index = before ? target.items.findIndex((t) => t.id === before) : -1;
    target.items.splice(index < 0 ? target.items.length : index, 0, { ...task, status });
    target.total++;
  }
  return { ...board, columns };
}

/** 移动成功：用服务端返回的任务（新 version、completedAt）替换本地那一张，并记下新的看板版本。 */
export function settleTask(board: BoardDTO, saved: TaskDTO, boardVersion: number): BoardDTO {
  // 看板只保存摘要，描述不留在卡片上。
  const { description, ...summary } = saved;
  void description;
  return {
    boardVersion,
    columns: board.columns.map((c) => ({ ...c, items: c.items.map((t) => (t.id === summary.id ? summary : t)) })),
  };
}
