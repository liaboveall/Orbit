# Orbit 维护约定

先读 README、package.json 与本次变更涉及的技术规范。产品行为、数据不变量与 API 分别以 docs/01-PRODUCT-SPEC.md、docs/04-DATA-MODEL.md 和 contracts/openapi.json 为准。修改接口时同步运行时校验和回归测试。

- src/app 负责路由，src/server 负责业务、认证和授权，src/contracts 负责契约，src/features 负责功能界面。
- 保持 TypeScript strict，校验外部输入。所有私有资源都在服务端校验会话、成员关系、资源归属与写权限。
- 数据库、认证和存储 SDK 只在服务端使用。私有数据不得进入跨用户共享缓存。
- 事务、并发和数据隔离用真实 PostgreSQL 验证。使用隔离的 orbit_test；保护生产与开发数据。
- 保留键盘替代操作、响应式布局、草稿保护及失败状态。部署过的迁移不可改写。
- 运行相关测试并记录实际结果。凭证、会话、邀请令牌和真实用户附件不得提交。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
