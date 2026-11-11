<div align="center">
  <img src="src/app/icon.svg" width="84" height="84" alt="">
  <h1>有序 Orbit</h1>
  <p><strong>让小团队的项目，有序向前。</strong></p>
  <p>为课程设计、比赛和小型开发项目打造的协作空间。<br>把任务、讨论和交付成果放在一起：谁在做什么，下一步做什么，一眼看清。</p>
  <p>
    <a href="https://smartorbit.tech/demo"><strong>体验在线 Demo ↗</strong></a>
    &nbsp;·&nbsp;
    <a href="https://smartorbit.tech">访问 Orbit</a>
    &nbsp;·&nbsp;
    <a href="README.en.md">English</a>
  </p>
</div>

<a href="https://smartorbit.tech/demo">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/media/hero-dark.webp">
    <img src="docs/media/hero-light.webp" width="960" alt="Orbit 的桌面看板和手机上的工作台。看板把任务分成待办、进行中和已完成三列。">
  </picture>
</a>

<p align="center"><sub>在线 Demo 无需注册，点开即可浏览。本页截图使用合成的演示数据，并和 Orbit 一样跟随浅色与深色模式。</sub></p>

## 从分工到交付，都在这里

### 看清进度

看板和列表是同一批任务的两种视图，负责人、优先级和截止日一眼可见。卡片可以拖拽，也可以用状态菜单或键盘移动。搜索和筛选写在地址里，刷新或分享后都还在。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/list-dark.webp">
  <img src="docs/media/list-light.webp" width="960" alt="任务列表视图：每行显示编号、标题、状态、优先级、负责人和截止日，逾期和今天到期的任务有醒目标记。">
</picture>

### 围绕任务协作

每条任务都有自己的面板：Markdown 描述、子任务清单、评论和私有附件。发一条一次性链接，就能把队友请进项目。两个人同时修改同一条任务时，后保存的人会看到提示，已经输入的内容原样保留。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/task-dark.webp">
  <img src="docs/media/task-light.webp" width="960" alt="任务面板的两个部分：左边是状态、优先级、负责人、截止日、描述和子任务，右边是评论和附件。">
</picture>

### 专注下一步

工作台把你在所有项目里负责的任务汇到一处，按逾期、今天到期、未来 7 天和进行中分好类。日期按你设置的时区计算。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/today-dark.webp">
  <img src="docs/media/today-light.webp" width="960" alt="我的工作台：顶部五个磁贴分别是全部未完成、逾期、今天到期、未来 7 天和进行中，下面是来自多个项目的任务列表。">
</picture>

## 安静的界面

Orbit 的界面语言接近 Apple 的液态玻璃。侧栏、导航和任务面板是浮在内容上方的半透明材质，内容本身保持简单、易读。

### 手机上同样完整

导航收进底部的浮动标签栏，看板一次显示一列，任务面板占满整屏。在 390 像素宽的屏幕上也能创建、查看和推进任务。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/mobile-dark.webp">
  <img src="docs/media/mobile-light.webp" width="960" alt="三部手机上的 Orbit：我的工作台、单列显示的看板和整屏的任务详情。">
</picture>

### 浅色与深色

配色跟随系统，两套配色的正文对比度都达到 WCAG AA。系统要求降低透明度时，玻璃退回实色；要求减少动态效果时，过渡动画关闭。

<img src="docs/media/themes.webp" width="960" alt="同一屏看板，左上是浅色模式，右下是深色模式。">

## 靠得住的细节

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>草稿不丢</strong><br>
      标题和描述的草稿在本机保存 7 天。刷新、浏览器崩溃或登录过期之后，都能接着写。
    </td>
    <td width="50%" valign="top">
      <strong>冲突不覆盖</strong><br>
      保存时如果任务已被别人改过，Orbit 会把两个版本都摆出来，由你决定用哪一个。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <strong>只用键盘也能完成</strong><br>
      拖拽、菜单、对话框和任务面板都有键盘操作，焦点始终看得见。
    </td>
    <td valign="top">
      <strong>删错了能找回</strong><br>
      删除的任务先进回收站。项目可以归档成只读，需要时再恢复。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <strong>附件是私有的</strong><br>
      文件存放在私有存储里。每次下载都重新检查权限，下载链接 60 秒后失效。
    </td>
    <td valign="top">
      <strong>权限由服务端把关</strong><br>
      每个请求都核对登录状态、成员关系和资源归属。不是项目成员，看到的只有“不存在”。
    </td>
  </tr>
</table>

## 技术栈

Orbit 是一个 Next.js 模块化单体：网页和 API 同源，业务逻辑独立于路由层。事务、并发和数据隔离都在真实的 PostgreSQL 上测试。

| 层 | 选型 |
| --- | --- |
| 应用 | Next.js 16（App Router）· React 19 · TypeScript strict |
| 界面 | Tailwind CSS 4 · Radix UI · dnd-kit · Lucide |
| 数据 | PostgreSQL 17 · Prisma 7 |
| 认证 | Better Auth：邮箱密码、邮箱验证、数据库会话 |
| 文件与邮件 | S3 兼容的私有对象存储 · SMTP |
| 测试与交付 | Vitest · Playwright · axe-core · GitHub Actions · Docker |

## 本地运行

需要 **Node.js 24+**、**pnpm 10.34.5** 和 **Docker Compose**。克隆仓库后，在项目根目录安装依赖并生成本地密钥。

~~~sh
pnpm install --frozen-lockfile
cp .env.example .env.local
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
~~~

Windows PowerShell 用 `Copy-Item .env.example .env.local`。将生成的值填入 `.env.local` 的 `BETTER_AUTH_SECRET`，再启动本地服务和应用。

~~~sh
docker compose -f infra/compose.dev.yml up -d --wait
pnpm db:migrate:deploy
pnpm dev
~~~

打开 [localhost:3000](http://localhost:3000)。注册验证邮件可在 [Mailpit](http://localhost:8025) 查看。只读 [/demo](http://localhost:3000/demo) 可直接体验。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `src/` | Next.js 页面和 API、功能组件、权限与业务服务 |
| `prisma/` · `contracts/` | PostgreSQL 数据模型、迁移和 OpenAPI 契约 |
| `infra/` · `scripts/` | 容器、反向代理、维护和备份 |
| `tests/` | 单元、契约、集成和浏览器回归 |

[架构与接口](docs/README.md) · [部署与恢复](docs/OCI-DEPLOYMENT.md) · [运行测试](tests/README.md)
