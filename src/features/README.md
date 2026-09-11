# src/features · 前端功能层

按领域组织的前端功能（组件、hooks、局部状态、RSC props + createApiClient / API 直调用法）。
规划子目录：`auth/ projects/ tasks/ board/ comments/ files/ activity/ today/`（见 docs/03 §3）。

**按里程碑「按需」创建**，不预建空目录。M0 仅保留顶层边界；功能层随 M1 起逐步落地。
客户端数据流用 RSC props + createApiClient / API 直调：服务器组件直查为数据真源，写操作后 router.refresh()，分页用请求代次绑定（generationRef）防旧响应污染（docs/03 §6）。`@tanstack/react-query` 已安装但当前未导入使用。
