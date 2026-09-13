# 有序 Orbit

面向个人与学生小团队的项目协作应用。把课程设计、比赛和开发项目中的任务、讨论与成果放在一起，让每个人知道接下来做什么。

[English](README.en.md) · [开发文档](docs/README.md) · [部署指南](docs/AWS-MICRO-DEPLOYMENT.md)

## 功能

- **项目协作**：创建项目、生成一次性邀请链接、管理成员、归档项目。
- **任务与看板**：列表与三列看板、搜索筛选、负责人、优先级、截止日，支持拖拽与菜单操作。
- **讨论与成果**：Markdown 描述、子任务、评论、私有附件和项目动态。
- **个人工作台**：集中查看分配给自己的任务与进度。
- **工作保护**：任务回收站、编辑冲突提示、未保存草稿保护和账户时区设置。

中文界面，支持桌面与手机核心操作。账户支持邮箱注册、验证和密码找回；项目区分所有者与成员，服务端校验访问权限。

## 体验

启动后访问 [只读演示](http://localhost:3000/demo)，无需登录即可浏览合成项目的看板、列表和任务详情，不读写私人项目。

真实协作流程：注册并验证邮箱 → 创建项目 → 复制邀请链接给队友 → 创建和分配任务 → 讨论、上传成果并完成任务。本地验证邮件在 [Mailpit](http://localhost:8025) 查看。

## 本地运行

需要 Node.js 24+、pnpm 10.34.5 和已启动的 Docker Compose。

```sh
git clone https://github.com/liaboveall/Orbit.git
cd Orbit
npm install -g pnpm@10.34.5
pnpm install --frozen-lockfile
```

1. 将 `.env.example` 复制为 `.env.local`（PowerShell：`Copy-Item .env.example .env.local`；macOS/Linux：`cp .env.example .env.local`）。
2. 运行以下命令生成随机值，填入 `.env.local` 的 `BETTER_AUTH_SECRET`；其余默认值用于本地 Compose。

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

3. 启动本地 PostgreSQL、MinIO 和 Mailpit：

   ```sh
   docker compose -f infra/compose.dev.yml up -d
   ```

4. 打开 [MinIO 控制台](http://localhost:9001)，使用 `.env.example` 中的本地存储账户登录，创建私有桶 `orbit-dev`（与 `STORAGE_BUCKET` 一致），用于附件上传。
5. 应用现有迁移并启动：

   ```sh
   pnpm db:migrate:deploy
   pnpm dev
   ```

访问 [Orbit](http://localhost:3000)，注册自己的账户。可选的 `pnpm db:seed` 仅创建开发数据，不提供可登录的演示账户；只读 `/demo` 无需 seed。

端口冲突、测试库初始化和完整变量说明见 [环境文档](docs/08-ENVIRONMENT-AND-DEPLOYMENT.md)。本地配置与凭证不提交到 Git。

## 开发与检查

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 开发服务器 |
| `pnpm build` / `pnpm start` | 构建 / 启动生产应用 |
| `pnpm check` | ESLint、应用类型检查、单元和契约测试 |
| `pnpm typecheck:scripts` | 工具脚本类型检查 |
| `pnpm test:integration` | 真实 PostgreSQL 集成测试 |
| `pnpm test:e2e` / `pnpm test:ui` | 业务流程 / 界面与键盘操作测试 |
| `pnpm db:migrate:dev` | 开发新功能时创建迁移 |
| `pnpm db:migrate:deploy` | 应用已提交的迁移 |

数据库和浏览器测试使用独立的 `orbit_test`，顺序执行。准备步骤见 [测试说明](tests/README.md)。

## 技术栈

Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 4、Radix UI；PostgreSQL 17、Prisma 7、Better Auth 和私有 S3 兼容存储。具体版本以 [package.json](package.json) 和锁文件为准。

```text
src/app/         页面与 API 路由
src/features/    项目、任务、看板等前端功能
src/server/      认证、权限、数据库与业务服务
src/contracts/   运行时校验、DTO 与 API 客户端
src/components/  通用界面组件
prisma/          数据模型、迁移与开发种子
contracts/       OpenAPI 契约
tests/           单元、契约、集成与浏览器测试
infra/           本地服务、生产编排与备份工具
```

## 部署与状态

支持持续运行的 Node.js 容器部署。参见 [AWS 部署指南](docs/AWS-MICRO-DEPLOYMENT.md) 和 [运行维护手册](docs/M6-OPERATIONS.md)，配置 PostgreSQL、私有对象存储、邮件、HTTPS 与备份。

核心协作功能已实现并完成本地验收；生产部署与外部验收仍在推进，AI 项目拆解助手尚未实现。当前状态、验收证据和待办见 [PROGRESS](PROGRESS.md) 与 [backlog](planning/backlog.json)。
