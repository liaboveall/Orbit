import "server-only";

/**
 * 子任务域公共出口（M5 / ORB-016）。
 * 路由层只从此处导入，不直连内部文件，保持路由层/业务层边界。
 */

export {
  createSubtask,
  createSubtaskRouteKey,
  deleteSubtask,
  listSubtasks,
  updateSubtask,
  type CreateSubtaskResult,
} from "./service";
export { toSubtaskDTO } from "./mappers";
export {
  countActiveSubtasks,
  subtaskLimitExceededError,
  subtaskNotFoundError,
  subtaskVersionConflictError,
} from "./access";
