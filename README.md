# 有序 Orbit · 项目仓库

版本：1.0 · 最新验证：2026-09-11 · 状态：**M0–M4 已完成收尾，可以开始 M5**。见 [修复关闭与准入结论](docs/reviews/M0-M4-FIX-CLOSURE-2026-09-11.md)。本轮发现的 A01–A07 已关闭；check、258 项集成、45 项 E2E、13 项 UI 及数据清理门禁通过，依赖扫描无已知漏洞。M5 从 ORB-016 子任务清单开始。

Orbit 是面向个人与学生小团队的项目协作 Web App。产品围绕创建项目、邀请成员、拆分任务、看板推进、讨论与成果附件展开。通过完整业务、清晰设计和可靠交付展示全栈能力。

本目录是应用仓库根目录。M0 工程与组件、M1 真实认证与设置、M2 项目与任务生命周期、M3 列表/看板/详情、M4 成员协作已实现并完成本轮验证。支持真实数据库拖拽排序、URL 筛选、隔离草稿、冲突恢复、分页和失败重试。工作台与 samples 保留明确标记的样例，后续子任务、评论附件、工作台和部署按 M5—M6 继续。实际锁定版本见 [版本记录](docs/versions.md)，当前验收以 [PROGRESS.md](PROGRESS.md) 为准。

## 交给 AI IDE 的最快方式

1. 将整个 Orbit 目录作为项目根目录打开。
2. 先读 [开发状态](PROGRESS.md) 和 [最新关闭报告](docs/reviews/M0-M4-FIX-CLOSURE-2026-09-11.md)，按 M5 / ORB-016 推进。E2E/UI 使用独立测试服务，结束时校验开发库和测试库内容指纹。集成测试使用独立 orbit_test。
3. 使用 [继续开发指令](prompts/CONTINUE.md)，每次推进一个里程碑。
4. 交接时让 Agent 更新 [开发状态](PROGRESS.md) 和 [任务清单](planning/backlog.json)。

不自动读取 AGENTS.md 的工具，请在消息中明确附加该文件与当前里程碑涉及的文档；无需安装特定 IDE 插件或修改全局配置。

## 本地开发准备（M0 实测可用）

> 前置：Node.js ≥ 24（本机在 v26.8.1 上实测通过，见 [docs/versions.md](docs/versions.md)）、Docker Desktop（用于本地 PostgreSQL/MinIO/Mailpit）。Windows 使用 pwsh。

1. **安装 pnpm（一次性）**：本机 Node 25+ 不再内置 corepack，使用全局安装的 pnpm 10.x：
   ```powershell
   npm install -g pnpm@10.34.5
   ```
   `package.json` 的 `packageManager` 字段已锁定该版本。
2. **安装依赖**（在仓库根目录）：
   ```powershell
   pnpm install
   ```
   依赖锁定在 `pnpm-lock.yaml`。pnpm 10 默认拦截依赖构建脚本，本项目已在 `package.json` 的 `pnpm.onlyBuiltDependencies` 显式批准 Prisma 引擎、esbuild 等原生构建。
3. **配置环境变量**：复制模板为本地文件（已被 `.gitignore` 忽略，切勿提交任何真实密钥）：
   ```powershell
   Copy-Item .env.example .env.local
   ```
   开发默认值可直接用于本地 compose；服务启动时由 `src/server/env.ts` 用 Zod 校验必需项（错误只显示变量名与预期格式，不回显值）。测试库使用独立的 `orbit_test`。
4. **启动本地依赖服务**（仅绑定 127.0.0.1）：
   ```powershell
   docker compose -f infra/compose.dev.yml up -d
   ```
   拉起 PostgreSQL 17（5432）、MinIO（9000/9001）、Mailpit（1025/8025）。init 脚本会自动创建 `orbit_dev` 与 `orbit_test`。
   > 若本机 5432 已被其它 PostgreSQL 占用，用宿主端口覆盖（不改动仓库默认值）：`$env:POSTGRES_HOST_PORT=5433; docker compose -f infra/compose.dev.yml up -d`，并把 `.env.local` 里连接串端口同步改为 5433。
5. **应用数据库迁移**（Prisma 7 使用 driver adapter；env 由 `prisma.config.ts` 显式加载 `.env.local`）：
   ```powershell
   pnpm db:migrate:dev
   pnpm db:seed
   ```
   当前包含 7 个迁移。开发库和独立测试库都需要应用迁移；运行测试前确认 TEST_DATABASE_URL 指向 orbit_test。
6. **启动开发服务器**：
   ```powershell
   pnpm dev
   ```
   访问 http://localhost:3000。

常用命令契约：`pnpm lint`（独立 `eslint .`，非 `next lint`）、`pnpm typecheck`、`pnpm build`、`pnpm test:unit` / `test:integration` / `test:e2e` / `test:contract`，以及 `pnpm check`（= lint + typecheck + test:unit + test:contract）。

## 阅读地图

| 文件 | 解决的问题 |
|---|---|
| [AGENTS.md](AGENTS.md) | 开发 Agent 的工作规则与规范优先级 |
| [00 · 执行总览](docs/00-EXECUTION-OVERVIEW.md) | 已确定的决策、版本边界、完成标准 |
| [01 · 产品需求](docs/01-PRODUCT-SPEC.md) | 用户、功能、业务规则、范围与验收 |
| [02 · 页面与视觉](docs/02-UX-AND-DESIGN.md) | 页面结构、视觉变量、交互、异常与无障碍 |
| [03 · 技术架构](docs/03-ARCHITECTURE.md) | 技术栈、目录、边界、缓存、并发与集成 |
| [04 · 数据与一致性](docs/04-DATA-MODEL.md) | 表、字段、索引、事务、排序和删除规则 |
| [05 · API 语义](docs/05-API-CONTRACT.md) | 接口约定、权限、错误、幂等与示例 |
| [OpenAPI](contracts/openapi.json) | V1 业务 API 的机器可读契约，不含认证库内部协议 |
| [06 · 开发里程碑](docs/06-IMPLEMENTATION-PLAN.md) | 任务依赖、实现内容、阶段验收和估时 |
| [07 · 测试与质量](docs/07-QUALITY-AND-TESTING.md) | 关键测试、性能、可访问性与安全验收 |
| [08 · 环境与交付](docs/08-ENVIRONMENT-AND-DEPLOYMENT.md) | 环境变量、开发、CI、发布、备份和恢复 |
| [09 · AI 增强功能](docs/09-AI-ASSISTANT-V1.1.md) | 核心完成后的项目拆解助手 |
| [10 · Agent 协作](docs/10-AGENT-HANDOFF.md) | 开发过程、任务交接、审查与需求变更 |
| [11 · 决策与风险](docs/11-DECISIONS-AND-RISKS.md) | 技术取舍、默认假设、风险应对 |
| [12 · 官方资料](docs/12-REFERENCES.md) | 技术来源与阅读方法 |
| [13 · 演示与求职](docs/13-DEMO-AND-PORTFOLIO.md) | 演示数据、演示路线、项目说明与简历证据 |
| [任务清单](planning/backlog.json) | 可交接任务、依赖、状态、对应验收项 |
| [规划校验](planning/validate_plan.py) | 文档链接、任务图和 OpenAPI 引用的静态检查 |

## 固定边界

- V1：账户、项目、两种角色、邀请、任务列表/看板、子任务、评论、私有附件、活动记录、我的工作台、部署与质量验证。
- V1.1：AI 项目拆解助手。基础产品无 AI 凭证也必须正常工作。
- 暂不做：原生手机 App、即时聊天、甘特图、收费订阅、自定义工作流、复杂组织体系、实时共同编辑。
- 桌面优先，手机可用；中文优先；API 与代码标识符使用英文。
- 不使用其他公司的品牌、素材或业务数据。与目标岗位对齐的是工程能力与设计质量。

技术基线：Node.js 24 LTS、TypeScript、Next.js 16 App Router、React、PostgreSQL 17、Prisma 7、Better Auth。客户端数据流采用 RSC + createApiClient / API 直调（服务器组件直查为数据真源，写操作后 router.refresh()）；`@tanstack/react-query` 已作为依赖安装但当前实现未导入使用（属预留，非第二套缓存真源）。具体兼容补丁版本由 M0 实测并写入锁文件，禁止使用无版本边界的 latest 作为长期依赖策略。

## 阅读副本与规划检查

希望一次通读时使用 [完整开发规划](DEVELOPMENT-PLAN.md)。它由专题文档汇总生成；开发时仍按主题和里程碑读取原文件，修改后重新生成。

规划检查：python planning/validate_plan.py。重新生成阅读副本：python planning/package_plan.py bundle。打包规划：python planning/package_plan.py zip。脚本只检查/打包规划，不运行应用，也不证明应用已完成。


## 文档维护

当前状态只读 [PROGRESS](PROGRESS.md) 与 backlog；当前验收只读
[最新报告](docs/reviews/M0-M4-FIX-CLOSURE-2026-09-11.md)。过时分析和旧修复交接已清理，
规范、ADR、正式测试与原始运行证据保留。测试操作见 [tests/README](tests/README.md)。
