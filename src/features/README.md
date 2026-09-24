# 前端功能层

按领域组织组件、hooks 和局部状态：auth、projects、tasks、board、members、invitations、activity、workbench、settings、shell 与只读 demo。评论、子任务和附件位于 tasks 内。

服务器组件传入数据，客户端通过契约层 API 客户端发起请求；写入后刷新相关数据。分页请求用代次绑定避免旧响应污染，编辑期间保留本地草稿。数据库、认证服务端实现和存储 SDK 不得进入客户端。详见 [架构](../../docs/03-ARCHITECTURE.md)。
