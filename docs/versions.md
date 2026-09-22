# 依赖与运行时

- 应用和开发依赖的精确版本以 [package.json](../package.json) 为准，完整依赖解析以 `pnpm-lock.yaml` 为准，不重复维护历史版本表。
- Node.js 支持范围和 pnpm 版本由 package.json 指定；CI 和 Dockerfile 使用 Node 24，部署以 Dockerfile 的固定镜像摘要为准。
- 本地服务版本以 [Compose](../infra/compose.dev.yml) 为准；生产配置见 [环境文档](08-ENVIRONMENT-AND-DEPLOYMENT.md)。
- Prisma、Client 与 adapter 保持兼容版本；Next API 先读已安装版本的 `node_modules/next/dist/docs/`，再查对应官方文档。
- 升级时核对 peer/engines、锁文件和 overrides，运行 [变更检查清单](14-CHANGE-AND-UPGRADE-CHECKLIST.md) 中相关验证。
- 不直接修改 node_modules 或将历史机器上的版本/测试结果当作当前环境事实。
