# src/features · 前端功能层

按领域组织的前端功能（组件、hooks、局部状态、TanStack Query 用法）。
规划子目录：`auth/ projects/ tasks/ board/ comments/ files/ activity/ today/`（见 docs/03 §3）。

**按里程碑「按需」创建**，不预建空目录。M0 仅保留顶层边界；功能层随 M1 起逐步落地。
客户端数据层用 TanStack Query，query key 必含 userId 与完整过滤条件（docs/03 §6）。
