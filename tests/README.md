# tests · 测试目录

五类测试，命令契约见 package.json（详见 docs/07、docs/08 §2）：

| 目录 | 命令 | 职责 |
|---|---|---|
| `unit/` | `pnpm test:unit` | 纯逻辑与必要组件测试（M0：环境校验 schema） |
| `contract/` | `pnpm test:contract` | OpenAPI / Zod / 业务响应契约（M0：openapi.json 结构骨架） |
| `integration/` | `pnpm test:integration` | 独立 PostgreSQL（orbit_test）上的 API/事务/权限（M0：空库可连接） |
| `e2e/` | `pnpm test:e2e` | Playwright 核心流程（M0：应用可访问冒烟） |
| `ui/` | `pnpm test:ui` | M0 开发样例：响应式导航、模态详情、键盘焦点和未保存草稿保护 |

`test:ui` 使用独立的 `playwright.ui.config.ts`，默认启动或复用 3000 端口的开发服务。已有开发服务时可使用 `$env:E2E_BASE_URL='http://localhost:3000'; pnpm test:ui`。样例在 production 下不可见，因此不能将 UI 回归指向 `pnpm start`。`test:e2e` 保留生产首页冒烟配置；两个命令分别运行。UI 失败截图与 trace 保存到 `test-results/`。

- `pnpm check` = lint + typecheck + test:unit + test:contract；integration/e2e 在 CI 另执行。
- 集成测试必须连**独立测试库**，脚本在连接前拒绝开发/生产库名（docs/08 §7）。
- M0 的 integration/e2e 是**已实现范围**的最小真实断言，不是永久 `exit 0` 的空脚本。
- e2e 首次运行需安装浏览器：`pnpm exec playwright install --with-deps chromium`。
