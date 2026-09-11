# Orbit 依赖版本与运行时基线（M0 / ORB-001 实测锁定）

- 记录日期：2026-09-08
- 记录人：开发 Agent（ORB-001）
- 依据：AGENTS.md「使用官方资料验证当前版本 API，锁定兼容版本」、docs/03 §1、docs/08。
- 本文件记录**实际锁定并验证通过**的版本；主版本基线来自规划文档，补丁版本由 M0 实测确定。
- 锁文件：`pnpm-lock.yaml`（已提交）。package.json 采用精确版本（无 `^`/`~`/`latest`）。

## 1. 运行时与工具链（本机实测环境）

| 组件 | 文档基线 | 本机实际 | 说明 |
|---|---|---|---|
| Node.js | 24 LTS | **v26.8.1** | ⚠ 偏离文档基线，见 §4 专项说明与验证证据 |
| pnpm | 兼容稳定版 | **10.34.5** | 全局 `npm i -g pnpm@10.34.5`；已写入 package.json `packageManager` |
| npm | — | 12.0.2 | 随 Node 26 提供 |
| corepack | — | 缺失 | Node 25+ 起不再内置 corepack；改用全局 pnpm，符合用户决策 |
| Docker Engine | — | 29.7.2 | Docker Desktop（Linux engine） |
| Docker Compose | — | v5.5.0 | `docker compose` 子命令 |
| Git | — | 2.55.0.windows.3 | 本地 `git init`（分支 master），本次未 commit/push |
| Python | — | 3.14.7 (anaconda3) | 仅规划校验脚本用 |

## 2. 应用依赖（精确锁定）

### dependencies

| 包 | 锁定版本 | 文档主版本基线 | 备注 |
|---|---|---|---|
| next | 16.3.4 | Next.js 16 App Router | 构建使用 Turbopack |
| react | 19.2.8 | React 19 | next 16.3.4 peer: `^19.0.0` ✓ |
| react-dom | 19.2.8 | React 19 | 同上 |
| zod | 4.5.4 | Zod（RHF 共享校验） | 环境变量启动校验 |
| @prisma/client | 7.10.0 | Prisma 7 | peer: typescript `>=5.4.0` ✓ |
| @prisma/adapter-pg | 7.10.0 | Prisma 7 PostgreSQL driver adapter | Prisma 7 强制 driver adapter |
| pg | 8.23.0 | — | adapter-pg 底层驱动（Prisma 官方安装命令要求显式安装） |
| dotenv | 17.4.2 | — | Prisma 7 不再自动加载 .env，需显式加载约定环境文件 |
| server-only | 0.0.1 | — | 保护 src/server 模块不进客户端 bundle |
| better-auth | 1.7.3 | Better Auth（M1/ORB-004 认证） | 传递依赖 `@better-auth/core@1.7.3`、`@better-auth/prisma-adapter@1.7.3`、`@better-auth/utils@0.4.2`；见 §7 |
| nodemailer | 10.0.1 | SMTP 邮件（ORB-005 接入 Mailpit） | **自带类型**（dist/cjs+esm 共 76 个 `.d.ts`），无需 `@types/nodemailer`；见 §7 |
| @radix-ui/react-avatar | 1.2.6 | Radix primitives（ORB-002 UI 原语） | 无障碍头像原语，Avatar/AvatarStack 基于此 |
| @radix-ui/react-dialog | 1.1.23 | Radix primitives（ORB-002 UI 原语） | Dialog/Drawer 复用其焦点陷阱、Escape、焦点恢复 |
| @radix-ui/react-dropdown-menu | 2.1.24 | Radix primitives（ORB-002 UI 原语） | 任务卡「更多」菜单，完整键盘导航 |
| @radix-ui/react-select | 2.3.7 | Radix primitives（ORB-002 UI 原语） | 看板筛选/任务详情下拉 |
| @radix-ui/react-tabs | 1.1.21 | Radix primitives（ORB-002 UI 原语） | 项目二级导航与手机按状态切换 |
| @radix-ui/react-toast | 1.2.23 | Radix primitives（ORB-002 UI 原语） | 瞬时提示，管理 aria-live 宣告 |
| @radix-ui/react-tooltip | 1.2.16 | Radix primitives（ORB-002 UI 原语） | 侧栏收窄/长名截断的完整标签 |
| lucide-react | 1.43.0 | Lucide 图标（ORB-002 UI 原语） | 线形图标，配文案不单靠颜色 |
| clsx | 2.1.1 | — | cn 工具条件拼接类名 |
| tailwind-merge | 3.6.0 | — | cn 工具去重冲突的 Tailwind 类 |

### devDependencies

| 包 | 锁定版本 | 文档主版本基线 | 备注 |
|---|---|---|---|
| typescript | 5.9.3 | TypeScript 5.x strict | ⚠ npm latest 已是 7.0.2（Go 重写版），按文档基线锁定 5.x；Prisma 7 推荐 5.9.x |
| prisma | 7.10.0 | Prisma 7 | ⚠ npm latest 已是 8.0.0-rc.13，按文档锁定 7；不混用 6/7/8 API |
| eslint | 9.39.5 | — | 见 §5 关于 deprecation 提示的决策 |
| eslint-config-next | 16.3.4 | — | 原生导出 flat config（`/core-web-vitals`、`/typescript`）；peer eslint `>=9` |
| tailwindcss | 4.3.3 | Tailwind CSS 4.x | 通过 @tailwindcss/postcss 接入 |
| @tailwindcss/postcss | 4.3.3 | — | 与 tailwindcss 同版本 |
| vitest | 5.0.0 | Vitest | engines: node `^22.12 || ^24 || >=26` ✓（支持 Node 26） |
| @playwright/test | 1.63.0 | Playwright | next 16.3.4 peer: `^1.51.1` ✓ |
| tsx | 4.23.13 | — | 运行 seed / scripts / prisma.config.ts |
| @types/node | 26.5.0 | — | 对齐 Node 26 |
| @types/react | 19.2.18 | — | |
| @types/react-dom | 19.2.7 | — | |
| @types/pg | 8.16.0 | — | |

> 未在 M0 安装（按任务范围，属后续里程碑）：TanStack Query / React Hook Form / @dnd-kit（功能里程碑按需锁定）。
>
> **M1/ORB-004 新增**：Better Auth（`better-auth@1.7.3`）与 `nodemailer@10.0.1` 已实际安装并锁定于上表 dependencies，详见 §7。未安装 `@better-auth/cli`（认证 schema 依据 1.7.3 官方字段手写，不跑版本可能漂移的 `auth@latest` CLI）；未安装 `@types/nodemailer`（nodemailer 10 自带类型）。
>
> 说明：Radix primitives（7 个 `@radix-ui/*` 包）与 Lucide（`lucide-react`）已在 ORB-002 实际安装并锁定于上表 dependencies——它们是本阶段 UI 基础组件（Dialog/Drawer/Select/Tabs/Toast/Tooltip/DropdownMenu/Avatar 与图标）的底层依赖，不再列为「未安装」。

## 3. 基础设施镜像

| 服务 | 镜像 | 实测版本 | 端口（仅绑 127.0.0.1） |
|---|---|---|---|
| PostgreSQL | `postgres:17` | **17.11** (Debian 17.11-1.pgdg13+2) | 5432（默认；可 `POSTGRES_HOST_PORT` 覆盖） |
| MinIO | `minio/minio:latest` | 浮动（开发用） | 9000 API / 9001 控制台 |
| Mailpit | `axllent/mailpit:latest` | 浮动（开发用） | 1025 SMTP / 8025 Web |

- PostgreSQL 主版本按文档锁定为 17。MinIO/Mailpit 为**开发期依赖**，用浮动标签；生产镜像 digest 锁定属 M6（ORB-021）。
- M0 验收只需 PostgreSQL 实际拉起（见 §4）；MinIO（M5 附件）、Mailpit（M1 邮件）在各自里程碑联调。

## 4. Node v26.8.1 偏离文档基线（Node 24 LTS）的说明与验证证据

**决策**（用户已批准）：在 Node 26 上实测；若全链路通过，则如实记录「偏离文档基线的实际版本 + 验证证据」，不静默把 26 当作 24 LTS。

**已知告警**：Prisma 7.10.0 的 `preinstall` 脚本在 Node 26 上打印告警：
> `Prisma only supports Node.js versions 20.19+, 22.12+, 24.0+. Please use a supported Node.js version.`

该告警**未阻断安装**（`preinstall: Done`），且 Prisma 的 generate/migrate/seed 在 Node 26 上均**实测可用**（新 `prisma-client` 生成器为 Rust-free，纯 JS；迁移引擎为独立二进制）。

**全链路验证证据（均在 Node v26.8.1 + pnpm 10.34.5 上实际执行通过）**：

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `pnpm install` | ✅ exit 0 | `Done in 14.1s`，526 包；构建脚本经 `pnpm.onlyBuiltDependencies` 批准后执行（@prisma/engines、esbuild、unrs-resolver、prisma） |
| `pnpm db:generate` | ✅ exit 0 | `Generated Prisma Client (7.10.0) to .\src\generated\prisma in 7ms` |
| `pnpm lint` | ✅ exit 0 | `eslint .` 无错误无告警 |
| `pnpm typecheck` | ✅ exit 0 | `prisma generate && tsc --noEmit`，strict 无类型错误 |
| `pnpm build` | ✅ exit 0 | `Next.js 16.3.4 (Turbopack)`，`Compiled successfully in 3.0s`，静态页 `/`、`/_not-found` 生成 |
| `pnpm test:unit` | ✅ 14 passed | 环境校验 schema（必需项/枚举/测试库隔离/NEXT_PUBLIC 秘密拦截/错误不回显值） |
| `pnpm test:contract` | ✅ 5 passed | `contracts/openapi.json` 结构骨架（OpenAPI 3.1、`/api/v1`、tags、paths） |
| `pnpm test:integration` | ✅ 3 passed | 连独立测试库 `orbit_test`：`SELECT 1`=1、`current_database()`=orbit_test、测试库≠开发库 |
| `pnpm db:seed` | ✅ exit 0 | `tsx prisma/seed.ts` 连接 `orbit_dev`；M0 无业务 fixture |
| `pnpm db:migrate:dev` | ✅ exit 0 | `Datasource "db": PostgreSQL database "orbit_dev" ... at "localhost:5433"` → `Already in sync, no schema change or pending migration`（M0 无模型，首个迁移随 M1 生成） |
| `pnpm check` | ✅ exit 0 | lint + typecheck + test:unit(14) + test:contract(5) 全通过 |
| `pnpm dev` | ✅ 可访问 | `Ready in 411ms`；`GET / 200 in 1560ms`；首页标题/正文渲染正常；验证后已停止进程 |
| `docker compose ... up -d postgres` + `scripts/check-db.ts` | ✅ | 容器 `postgres:17` = **17.11** healthy；`orbit_dev`/`orbit_test` 均由 init 脚本创建；check-db 连接成功 |

**结论**：全链路在 Node v26.8.1 上通过，无功能性阻断。唯一副作用是 Prisma preinstall 的版本告警（非致命）。

**遗留风险 / 后续动作**：
- 若需严格对齐文档基线，可在 CI 中同时用 Node 24 LTS 跑一遍 `pnpm check`（GitHub Actions 属后续 CI 任务）。
- Prisma 官方支持矩阵未含 Node 26；升级到 Prisma 8（当前 rc）或 Node 回归 24 LTS 属后续单独评估，不在 ORB-001 范围。

## 5. 其它版本决策记录

- **eslint 9.39.5 的 npm deprecation 提示**：安装时提示 “This version is no longer supported”（eslint 10 已发布）。保留 9.39.5 的理由：它是 Next.js 16 官方随附、且与 `eslint-config-next@16.3.4` 内置的 `typescript-eslint@^8.46` 完全兼容；贸然升 eslint 10 存在 flat-config/插件破坏性变更风险。升级到 eslint 10 留待后续单独评估。
- **不追 latest 主版本**：typescript（7.0.2）、prisma（8.0.0-rc.13）均按文档主版本基线锁定在 5.x / 7.x，符合 AGENTS.md「禁止无版本边界的 latest」「不混用 Prisma 6/7/8」。
- **pnpm 构建脚本白名单**：pnpm 10 默认拦截依赖构建脚本；已在 package.json `pnpm.onlyBuiltDependencies` 显式批准 `@prisma/engines`、`prisma`、`esbuild`、`unrs-resolver`，否则 Prisma 引擎/esbuild 原生二进制不会安装。

## 6. 本机端口冲突处置（验证记录）

本机已有一个**原生 PostgreSQL 进程**（PID 9992）占用 5432，导致 compose 绑定 `127.0.0.1:5432` 失败
（`bind: An attempt was made to access a socket in a way forbidden by its access permissions`）。
处置：未终止用户的原生数据库进程；将 compose 的宿主端口参数化为 `${POSTGRES_HOST_PORT:-5432}`（**默认仍为文档推荐的 5432**，提交内容不偏离 docs/.env.example），本次验证用 `POSTGRES_HOST_PORT=5433` 起库，并把本地 `.env.local`（已 gitignore，不提交）的连接串端口改为 5433。`.env.example` 与 compose 默认值保持 5432 不变。

## 7. M1 / ORB-004 认证依赖锁定与验证（2026-09-08）

- 记录人：开发 Agent（ORB-004）
- 依据：AGENTS.md「使用官方资料验证当前版本 API，锁定兼容版本」「不混用不同认证库版本的示例」、docs/03 §5、docs/04、docs/06 M1。

### 7.1 锁定版本

| 包 | 锁定版本 | 类型 | 备注 |
|---|---|---|---|
| better-auth | 1.7.3 | dependencies | 认证核心；`betterAuth()`、`prismaAdapter`（`better-auth/adapters/prisma`）、`toNextJsHandler`（`better-auth/next-js`）、`auth.api.*` server API |
| @better-auth/core | 1.7.3 | 传递依赖 | better-auth 内部核心；认证 schema 字段权威来源（`dist/db/schema/*.mjs`） |
| @better-auth/prisma-adapter | 1.7.3 | 传递依赖 | Prisma 适配器；peer `@prisma/client@7.10.0` ✓ |
| @better-auth/utils | 0.4.2 | 传递依赖 | 加密/编码工具 |
| nodemailer | 10.0.1 | dependencies | SMTP 邮件；自带类型（无需 `@types/nodemailer`）；ORB-004 仅占位日志，ORB-005 接 Mailpit |

- **API 验证方式**：认证四表（User/Session/Account/Verification）字段直接取自已安装的 `@better-auth/core@1.7.3/dist/db/schema/*.mjs`（权威），未凭记忆、未跑 `auth@latest` CLI（其版本可能与 1.7.3 漂移）。`betterAuth` 配置项、`prismaAdapter(prisma, { provider: "postgresql" })`、`toNextJsHandler` 导出均以 `node_modules/better-auth@1.7.3` 的实际类型/导出核对。
- **nodemailer 类型**：package.json 无顶层 `types` 字段，但 `dist/cjs`+`dist/esm` 附带 76 个 `.d.ts`，TS 经 `main`(`./dist/cjs/nodemailer.js`) 解析到相邻 `.d.ts`，类型完整；故**未安装** `@types/nodemailer`。

### 7.2 vitest peer dependency 警告与规避策略

- **现象**：`better-auth@1.7.3` 的 peerDependencies 含 `vitest: ^2 || ^3 || ^4`，而本项目锁定 `vitest@5.0.0`。`pnpm install` 打印 `unmet peer vitest@"^2||^3||^4": found 5.0.0` 警告。
- **判定**：该 peer 仅服务于 better-auth 自带的 **vitest 插件 / test-client**（`better-auth/vitest` 等测试工具链），与运行时认证核心无关。警告**不阻断安装**（`Done`），better-auth 运行时功能不受影响。
- **决策（不降级 vitest）**：保留 `vitest@5.0.0`（其 engines 支持 Node 26，M0 全链路已验证）。**不使用** better-auth 的 vitest 插件 / test-client；集成测试 `tests/integration/auth.test.ts` 改为**直接调用 Better Auth 官方 server API（`auth.api.*`）**建立夹具会话（signUpEmail / signInEmail / getSession / revokeSession），从 `Set-Cookie` 取会话 cookie。这样既规避 peer 版本冲突，又贴合 docs/06 M1「用 server API 验证会话」的完成条件。
- **后续**：若未来确需 better-auth 的 vitest 集成，须单独评估 vitest 主版本对齐（属后续里程碑，不在 ORB-004 范围）。

### 7.3 M1 迁移与验证证据

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `pnpm db:migrate:dev` | ✅ exit 0 | 生成首个迁移 `20260908162114_init_auth`（User/Session/Account/Verification + User.timezone），应用到 `orbit_dev`(localhost:5433) |
| `pnpm db:migrate:deploy`（TEST_DATABASE_URL→orbit_test） | ✅ exit 0 | 空库 `orbit_test` 上重复部署同一迁移成功（验证 migrate deploy 幂等语义） |
| `pnpm typecheck` | ✅ exit 0 | `prisma generate && tsc --noEmit`，strict + noUncheckedIndexedAccess 无类型错误 |
| `pnpm lint` | ✅ 见 §报告 | eslint flat config，含新增 features/components 边界规则 |
| `pnpm build` | ✅ 见 §报告 | Next.js 16.3.4，`/api/auth/[...all]` 路由编译 |
| `pnpm test:integration` | ✅ 见 §报告 | orbit_test 真实库：schema 存在、创建用户+会话、会话失效/隔离、无凭证输出 |
