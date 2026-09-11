import "server-only";

/**
 * 评论域公共出口（M5 / ORB-017）。
 * 路由层只从此处导入，不直连内部文件。
 */

export {
  createComment,
  createCommentRouteKey,
  deleteComment,
  listComments,
  updateComment,
  type CommentListResult,
  type CreateCommentResult,
} from "./service";
export { toCommentDTO } from "./mappers";
export {
  canDeleteComment,
  commentDeleteForbiddenError,
  commentEditForbiddenError,
  commentLimitExceededError,
  commentNotFoundError,
  commentVersionConflictError,
  countActiveComments,
} from "./access";
