import "server-only";

/**
 * 活动领域服务统一出口（M2 写入 / M4 读取）。
 *
 * 路由层与其它领域服务只从本入口引用活动能力，屏蔽内部文件划分：
 *  - writer：事务内**只追加**活动日志（appendActivity）与 metadata 白名单过滤；
 *  - reader：分页读取项目活动（listActivities，契约 listActivity）。
 */

export {
  appendActivity,
  filterActivityMetadata,
  type ActivityEntry,
} from "./writer";
export {
  listActivities,
  type ActivityListOptions,
  type ActivityListResult,
} from "./reader";
