import "server-only";

/**
 * 任务领域服务统一出口（M2 / ORB-008）。
 *
 * 路由层只从本入口引用 create/read/update/soft-delete/restore 服务，屏蔽内部文件划分；
 * position/identifier/date-only/access/mappers 为任务域内部辅助，仅供本目录服务复用，
 * 不在此重导出（单元测试可直接按文件路径引入被测辅助）。
 * 授权（authorization）、幂等（idempotency）、活动（activity）、分页（pagination）
 * 为跨领域共享基础设施，各自有独立入口，不在此重导出。
 */

export {
  createTask,
  createTaskRouteKey,
  type CreateTaskResult,
} from "./create";
export {
  listProjectTasks,
  getTask,
  // ORB-010: 任务详情别名为 findTaskDetail（与 API contract 一致）
  getTask as findTaskDetail,
  type TaskListResult,
} from "./read";
export { updateTask } from "./update";
export { softDeleteTask } from "./soft-delete";
export {
  restoreTask,
  restoreTaskRouteKey,
  type RestoreTaskResult,
} from "./restore";
export { toTaskDTO, toTaskSummaryDTO } from "./mappers";
export { moveTask } from "./move";
export { createMoveRecord, getTaskMoveHistory } from "./move-record";
