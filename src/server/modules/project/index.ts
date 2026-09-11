import "server-only";

/**
 * 项目领域服务统一出口（M2 / ORB-007）。
 *
 * 路由层只从本入口引用 create/read/update 服务，屏蔽内部文件划分；
 * 授权（authorization）、幂等（idempotency）、活动（activity）、分页（pagination）
 * 为跨领域共享基础设施，各自有独立入口，不在此重导出。
 */

export {
  createProject,
  type CreateProjectResult,
  CREATE_PROJECT_ROUTE_KEY,
} from "./create";
export {
  getProject,
  listMembers,
  listProjects,
  type ProjectListResult,
} from "./read";
export { updateProject } from "./update";
export { toProjectDTO, projectRoleForViewer } from "./mappers";
